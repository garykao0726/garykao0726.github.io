/**
 * oringo-data.js — 中央 Sheet 常數讀取層
 * 唯一真相：中央 Sheet「月目標」「參數」「門市基準值」三張分頁
 * 無快取、無內建常數複本：讀取失敗就顯示錯誤橫幅，不靜默顯示錯的數字
 */
window.ORINGO = (function () {
  const SHEET_ID = '17hTgCpF0mBTHf3RcnDmRFrJMeLBn3nRdTMuG8l58QjY';
  const TIMEOUT_MS = 10000;
  let _seq = 0;

  /* ── HTML escape：任何 Sheet 值進 innerHTML 前必須過這裡 ── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ── 錯誤橫幅：不得靜默顯示 0 或空白 ── */
  function showErrorBanner(msg) {
    if (document.getElementById('oringo-error-banner')) return;
    const el = document.createElement('div');
    el.id = 'oringo-error-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;' +
      'background:#A54A1A;color:#F5EDE3;font-family:"Noto Sans TC",sans-serif;' +
      'font-size:.85rem;padding:10px 16px;text-align:center;';
    el.textContent = '⚠ 資料載入失敗，請重新整理（' + msg + '）';
    document.body.prepend(el);
  }

  /* ── gviz JSONP：回傳「以表頭欄名為 key 的物件陣列」，不回位置陣列 ──
     防插欄位移：協作者插一欄，位置取值會讓營收變成本而無人察覺

     ⚠ 實測發現（2026-07-12）：Google gviz 對「查詢不存在的分頁名稱」不會回錯，
     而是靜默 fallback 回傳工作簿第一個分頁的資料！這代表呼叫方「一定」要傳
     required（且盡量給多個、該分頁獨有的欄名組合），否則分頁被刪/改名時，
     這裡會拿到別的分頁資料當成功回傳，而不是報錯。*/
  function gviz(tabName, opts) {
    opts = opts || {};
    const required = opts.required || [];
    const sheetId = opts.sheetId || SHEET_ID;
    const cbName = '_oringoGvizCb' + (++_seq);

    return new Promise((resolve, reject) => {
      let settled = false;
      const script = document.createElement('script');

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        window[cbName] = function () {}; // 遲到的 callback 不炸掉
        delete window[cbName];
        script.remove();
        reject(new Error(tabName + ' 讀取逾時'));
      }, TIMEOUT_MS);

      window[cbName] = function (resp) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        delete window[cbName];
        script.remove();

        if (!resp || resp.status === 'error') {
          reject(new Error(tabName + ' 讀取失敗：' +
            (resp && resp.errors && resp.errors[0] && resp.errors[0].detailed_message || '未知錯誤')));
          return;
        }

        const cols = (resp.table && resp.table.cols) || [];
        const rows = (resp.table && resp.table.rows) || [];
        const headers = cols.map(c => c.label || c.id || '');

        // 0 列＝視為失敗，不當成「合法的空資料」使用
        if (rows.length === 0) {
          reject(new Error(tabName + ' 回傳 0 列，視為讀取失敗'));
          return;
        }

        const objs = rows.map(r => {
          const o = {};
          (r.c || []).forEach((cell, i) => {
            if (headers[i]) o[headers[i]] = cell ? cell.v : null;
          });
          return o;
        });

        const missing = required.filter(h => !headers.includes(h));
        if (missing.length) {
          reject(new Error(tabName + ' 缺少必要欄位：' + missing.join(',')));
          return;
        }

        resolve(objs);
      };

      script.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        delete window[cbName];
        reject(new Error(tabName + ' 讀取失敗（網路或分頁不存在）'));
      };
      script.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq` +
        `?tqx=responseHandler:${cbName}&sheet=${encodeURIComponent(tabName)}`;
      document.head.appendChild(script);
    });
  }

  /* ── getConfig：讀「月目標」+「參數」+「門市基準值」──
     欄位缺失/讀取失敗一律 reject，呼叫端負責顯示錯誤橫幅，不自行假設數值 */
  async function getConfig() {
    try {
      const [monthlyRows, paramRows, benchRows] = await Promise.all([
        gviz('月目標', { required: ['項目'] }),
        gviz('參數', { required: ['key', 'value'] }),
        gviz('門市基準值', { required: ['門市', '轉換率目標', '客單價目標'] }),
      ]);

      const monthKeys = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
      const monthlyTargets = {};
      let adBudgetMonthly = null;
      monthlyRows.forEach(r => {
        const key = r['項目'];
        const arr = monthKeys.map(mk => Number(r[mk]) || 0);
        if (key === '月廣告費預算') adBudgetMonthly = arr;
        else monthlyTargets[key] = arr;
      });

      const params = {};
      paramRows.forEach(r => { params[r['key']] = isNaN(Number(r['value'])) ? r['value'] : Number(r['value']); });

      const storeBenchmarks = {};
      benchRows.forEach(r => {
        storeBenchmarks[r['門市']] = {
          conv: Number(r['轉換率目標']) || 0,
          ticket: Number(r['客單價目標']) || 0,
        };
      });

      return { monthlyTargets, adBudgetMonthly, params, storeBenchmarks, _source: 'sheet' };
    } catch (e) {
      showErrorBanner(e.message);
      throw e;
    }
  }

  const fmt = {
    money: n => n >= 100000 ? 'NT$ ' + (n / 10000).toFixed(0) + ' 萬' : 'NT$ ' + Number(n).toLocaleString(),
    man: n => (n / 10000).toFixed(0) + ' 萬',
    num: n => Number(n).toLocaleString(),
    pct: n => Number(n).toFixed(1) + '%',
  };

  return { SHEET_ID, gviz, getConfig, esc, fmt, showErrorBanner };
})();
