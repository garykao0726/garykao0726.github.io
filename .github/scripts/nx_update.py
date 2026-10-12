#!/usr/bin/env python3
"""南西誠品月報：把指定月份的定稿資料寫進 operation.html 的 NX_MONTHS（一個月一行 JSON）。

用法（在 garykao0726.github.io repo 根目錄）：
    NX_KEY=<金鑰> python3 nx_update.py 202610            # 取 GAS 端點(Shopline POS)＋中央Sheet月目標＋日報Sheet手記
    NX_KEY=<金鑰> python3 nx_update.py 202610 --dry      # 只印結果，不寫檔
資料來源：
  1) GAS 端點 nxMonth：南西逐日營業額/訂單、商品屬性、Top 鞋款、五店同窗口鞋款結構（Shopline POS，權威來源）
  2) 中央 Sheet「月目標」分頁的「南西」列（萬元）→ 月目標，不受日報 Sheet 換月影響
  3) 南西日報 Sheet（只在該月還在 Sheet 上時）→ 來客/成交/成交率/日目標等門市手記；
     Sheet 已換月則沿用 operation.html 既有條目（例如月中快照）裡的手記，沒有的日期留空(null)顯示「—」
改寫既有月份條目時，保留手寫欄位（wkNote/wdNote/insights/extraHtml/tag）。
"""
import sys, os, re, json, csv, io, datetime, urllib.request, urllib.parse

GAS_URL = 'https://script.google.com/macros/s/AKfycbzCi6U8ybTeoloT4m659m7Z67pQ58uH96KmMQP1TJrV6MAgcnHUKNJyHtNI164xkbox/exec'
NX_SHEET = '1N_02nfF7KitPExgIp2iZjVD9t4ZqczItP1l-KoyqPY8'
NX_TAB = '林果dashboard_南西誠品'
CENTRAL_SHEET = '17hTgCpF0mBTHf3RcnDmRFrJMeLBn3nRdTMuG8l58QjY'
WEEK = ['一', '二', '三', '四', '五', '六', '日']
BEGIN, END = '/*NX_ENTRIES_BEGIN*/', '/*NX_ENTRIES_END*/'


def http(url, timeout=330):
    req = urllib.request.Request(url, headers={'User-Agent': 'nx-update/1.0'})
    return urllib.request.urlopen(req, timeout=timeout).read().decode('utf-8')


def fetch_gas(ym, key):
    url = GAS_URL + '?' + urllib.parse.urlencode({'action': 'nxMonth', 'ym': ym, 'key': key})
    d = json.loads(http(url))
    if not d.get('ok'):
        raise SystemExit('GAS 端點失敗：%s' % d)
    return d


def fetch_month_target(ym):
    """中央 Sheet「月目標」分頁，南西列（萬元）→ 元。"""
    url = 'https://docs.google.com/spreadsheets/d/%s/gviz/tq?tqx=out:csv&sheet=%s' % (CENTRAL_SHEET, urllib.parse.quote('月目標'))
    rows = list(csv.reader(io.StringIO(http(url, 60))))
    hdr = rows[0]
    col = hdr.index('%d月' % int(ym[4:]))
    for r in rows[1:]:
        if r and r[0] == '南西':
            v = float(r[col] or 0)
            return int(round(v * 10000)) if v > 0 else None
    return None


def fetch_sheet_days(ym):
    """日報 Sheet 目前顯示的月份若等於 ym，回傳 {日: dict}；否則回傳 {}（已換月）。"""
    url = 'https://docs.google.com/spreadsheets/d/%s/gviz/tq?tqx=out:json&sheet=%s&range=A6:R40' % (NX_SHEET, urllib.parse.quote(NX_TAB))
    t = http(url, 60)
    j = json.loads(re.search(r'\((\{.*\})\)', t, re.S).group(1))
    out = {}
    for r in j['table']['rows']:
        c = [(x or {}).get('v') for x in r['c']]
        if not c or c[0] is None:
            break
        m = re.match(r'Date\((\d+),(\d+),(\d+)\)', str(c[0]))
        if not m:
            continue
        yy, mo, dd = int(m.group(1)), int(m.group(2)) + 1, int(m.group(3))
        if '%04d%02d' % (yy, mo) != ym:
            continue
        g = lambda i: (c[i] if len(c) > i else None)
        out[dd] = dict(target=g(2), conv=g(5), vis=g(8), txn=g(11), rev=g(15))
    return out


def load_entries(html):
    a, b = html.index(BEGIN), html.index(END)
    entries = {}
    for line in html[a + len(BEGIN):b].split('\n'):
        m = re.match(r'\s*"(\d{6})":\s*(\{.*\}),?\s*$', line)
        if m:
            entries[m.group(1)] = json.loads(m.group(2))
    return entries


def render_entries(entries):
    return '\n' + '\n'.join('  "%s": %s,' % (k, json.dumps(entries[k], ensure_ascii=False, separators=(',', ':'))) for k in sorted(entries)) + '\n'


def num(v, ndigits=None):
    if v is None:
        return None
    try:
        return int(round(float(v)))
    except Exception:
        return None


def build_entry(ym, gas, target, sheet_days, existing):
    y, m = int(ym[:4]), int(ym[4:])
    last, month_days, partial = gas['lastDay'], gas['monthDays'], gas['partial']
    ex_days = {}
    for d in (existing or {}).get('days', []):
        ex_days[int(d[0].split('/')[1])] = d
    days, diffs = [], []
    for dd, rev, _orders in gas['nx']['daily']:
        sh, ex = sheet_days.get(dd), ex_days.get(dd)
        tgt = vis = txn = conv = None
        if sh:
            tgt = num(sh['target']) or None
            vis, txn = num(sh['vis']), num(sh['txn'])
            conv = num(sh['conv'] * 100) if sh['conv'] is not None else None
            if sh['rev'] is not None and abs(num(sh['rev']) - rev) > 0:
                diffs.append((dd, num(sh['rev']), rev))
        elif ex:
            tgt, vis, txn, conv = ex[2], ex[4], ex[5], ex[6]
        days.append(['%d/%d' % (m, dd), WEEK[datetime.date(y, m, dd).weekday()], tgt, rev, vis, txn, conv])
    pos = {'orders': gas['nx']['orders'], 'rev': gas['nx']['rev']}
    prod = {'winLabel': '%d/%d–%d/%d' % (m, gas['win']['from'], m, gas['win']['to']),
            'nx': gas['nx']['stats'], 'stores': gas['win']['stores'], 'top': gas['nx']['top']}
    e = dict(existing or {})
    e.update({'label': '%d 年 %d 月' % (y, m), 'short': '%d / %02d' % (y, m), 'first': '%d/1' % m,
              'target': target or e.get('target') or 0, 'pos': pos, 'prod': prod, 'days': days})
    if partial:
        e.update({'partial': True, 'asOf': '%d/%d' % (m, last), 'monthDays': month_days})
        e['tag'] = e.get('tag') or '月中快照'
    else:
        for k in ('partial', 'asOf', 'monthDays'):
            e.pop(k, None)
        if e.get('tag') == '月中快照':
            e.pop('tag')
    if ym == '202609' and not e.get('tag'):
        e['tag'] = '開幕月'
    if not existing or e.get('noteAuto'):
        parts = []
        if partial:
            parts.append('月中快照（非即時）：資料累計至 %d/%d，月底結算後以定稿數字更新。' % (m, last))
        parts.append('營業額以 Shopline POS 為準（%d 張訂單，排除取消單，$%s，含稅）。' % (pos['orders'], format(pos['rev'], ',')))
        if sheet_days:
            if diffs:
                parts.append('日報 Sheet 逐日有 %d 天與 POS 入帳日不同。' % len(diffs))
            else:
                parts.append('日報 Sheet 逐日與 POS 完全一致。')
        parts.append('來客／成交／成交率為門市手記（缺的日期顯示 —，數字僅供參考）。客單價＝營業額 ÷ POS 訂單數。')
        e['note'] = ''.join(parts)
        e['noteAuto'] = True
    return e, diffs


def main():
    ym = sys.argv[1]
    dry = '--dry' in sys.argv
    path = 'operation.html'
    if '--file' in sys.argv:
        path = sys.argv[sys.argv.index('--file') + 1]
    key = os.environ.get('NX_KEY')
    if '--gas-json' in sys.argv:
        gas = json.load(open(sys.argv[sys.argv.index('--gas-json') + 1], encoding='utf-8'))
    else:
        if not key:
            raise SystemExit('缺少環境變數 NX_KEY')
        gas = fetch_gas(ym, key)
    html = open(path, encoding='utf-8').read()
    entries = load_entries(html)
    existing = entries.get(ym)
    if existing and not existing.get('partial') and '--force' not in sys.argv:
        print('%s 已有定稿條目，略過（加 --force 可強制重建）' % ym)
        return
    target = fetch_month_target(ym)
    if not target and not (existing or {}).get('target'):
        raise SystemExit('抓不到 %s 的南西月目標（中央 Sheet「月目標」分頁）' % ym)
    sheet_days = {} if '--no-sheet' in sys.argv else fetch_sheet_days(ym)
    entry, diffs = build_entry(ym, gas, target, sheet_days, existing)
    entries[ym] = entry
    rev = gas['nx']['rev']
    print('%s：營業額 %s｜POS 訂單 %d｜目標 %s｜達成 %.1f%%｜%s｜Sheet 手記 %s｜逐日差異 %d 天' % (
        ym, format(rev, ','), gas['nx']['orders'], format(entry['target'], ','), rev / entry['target'] * 100,
        '月中(至 %s)' % entry.get('asOf') if entry.get('partial') else '整月',
        '有(%d 天)' % len(sheet_days) if sheet_days else '無(沿用既有/留空)', len(diffs)))
    if dry:
        return
    new = html[:html.index(BEGIN) + len(BEGIN)] + render_entries(entries) + html[html.index(END):]
    open(path, 'w', encoding='utf-8').write(new)
    print('已寫入 %s' % path)


if __name__ == '__main__':
    main()
