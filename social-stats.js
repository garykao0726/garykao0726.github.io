/* 社群短網址頁「發文成效」的統計邏輯（純函式，頁面與 Node 測試共用）。
   輸入＝後端 stats 動作回傳的 posts（每則貼文已配好 GA4 的造訪／加購／購買／營收）。
   原則：比率一律用「加總後再除」（不是各貼文比率的平均）；樣本太少的組別照樣列出但標示。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SocialStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_AGE = 7;          // 發文滿幾天才算「數字大致穩定」
  var MIN_POSTS = 3;        // 一組至少幾則貼文才不算樣本少
  var MIN_VISITS = 200;     // 一組至少幾次造訪才不算樣本少
  var MIN_BUYS = 5;         // 標「轉換率／每則營收領先」之前，這組至少要有幾筆購買
  var WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  var METRICS = {
    avgVisits: { label: '每則平均造訪', short: '每則造訪', digits: 0 },
    engRate:   { label: '互動率（有互動的造訪 ÷ 造訪）', short: '互動率', digits: 1, pct: true },
    atcRate:   { label: '加購率（加購次數 ÷ 造訪）', short: '加購率', digits: 1, pct: true },
    cvr:       { label: '轉換率（購買 ÷ 造訪）', short: '轉換率', digits: 2, pct: true, hint: '深綠長條＝購買達 ' + MIN_BUYS + ' 筆以上的組別中最高的；購買不到 ' + MIN_BUYS + ' 筆的組別，比率容易被少數幾筆拉高，僅供參考。' },
    avgRev:    { label: '每則平均營收', short: '每則營收', digits: 0, money: true, hint: '深綠長條＝購買達 ' + MIN_BUYS + ' 筆以上的組別中最高的；購買不到 ' + MIN_BUYS + ' 筆的組別，比率容易被少數幾筆拉高，僅供參考。' }
  };

  function num(x) { x = Number(x); return isFinite(x) ? x : 0; }
  function div(a, b) { return b > 0 ? a / b : null; }
  function fmtInt(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
  function fmtPct(n, d) { return n == null ? '—' : n.toFixed(d == null ? 1 : d) + '%'; }
  function fmtMoney(n) { return n == null ? '—' : 'NT$ ' + Math.round(n).toLocaleString('en-US'); }
  function fmtMetric(metric, v) {
    var m = METRICS[metric];
    if (v == null) return '—';
    if (m.money) return fmtMoney(v);
    if (m.pct) return fmtPct(v, m.digits);
    return fmtInt(v);
  }

  /* ---- 篩選 ---- */
  function filterPosts(posts, matureOnly) {
    return (posts || []).filter(function (p) { return !matureOnly || num(p.ageDays) >= MIN_AGE; });
  }

  /* ---- 加總與衍生指標 ---- */
  function derive(g) {
    g.avgVisits = div(g.visits, g.n);
    g.engRate = div(g.engaged * 100, g.visits);
    g.atcRate = div(g.atc * 100, g.visits);
    g.cvr = div(g.buys * 100, g.visits);
    g.avgRev = div(g.rev, g.n);
    g.low = g.n < MIN_POSTS || g.visits < MIN_VISITS;
    g.lowWhy = g.n < MIN_POSTS ? '只有 ' + g.n + ' 則貼文' : (g.visits < MIN_VISITS ? '造訪只有 ' + fmtInt(g.visits) + ' 次' : '');
    return g;
  }
  function newGroup(key, label) { return { key: key, label: label, n: 0, visits: 0, engaged: 0, atc: 0, buys: 0, rev: 0, posts: [] }; }
  function add(g, p) {
    g.n++; g.visits += num(p.sessions); g.engaged += num(p.engaged); g.atc += num(p.addToCarts); g.buys += num(p.purchases); g.rev += num(p.revenue); g.posts.push(p);
  }
  function totals(posts) {
    var g = newGroup('all', '全部');
    (posts || []).forEach(function (p) { add(g, p); });
    return derive(g);
  }
  function groupBy(posts, keyFn, labelFn) {
    var by = {}, order = [];
    (posts || []).forEach(function (p) {
      var k = keyFn(p);
      if (!by[k]) { by[k] = newGroup(k, labelFn(p, k)); order.push(k); }
      add(by[k], p);
    });
    return order.map(function (k) { return derive(by[k]); });
  }

  var byChannel = function (posts) { return groupBy(posts, function (p) { return p.channel; }, function (p) { return p.channelLabel; }); };
  var byType = function (posts) { return groupBy(posts, function (p) { return p.type; }, function (p) { return p.typeLabel; }); };
  function byWeekday(posts) {
    var gs = groupBy(posts, function (p) { return String(p.dow); }, function (p) { return WEEKDAYS[p.dow]; });
    gs.sort(function (a, b) { return ((Number(a.key) + 6) % 7) - ((Number(b.key) + 6) % 7); });     // 週一 → 週日
    return gs;
  }
  // 活動主題：有填活動名稱的依名稱分組；只出現 1 則的併成「其他活動」；沒填的是「一般貼文」
  function byActivity(posts) {
    var norm = function (p) { return String(p.activity || '').replace(/\s+/g, ' ').trim(); };
    var cnt = {}, first = {};
    (posts || []).forEach(function (p) { var a = norm(p), k = a.toLowerCase(); if (a) { cnt[k] = (cnt[k] || 0) + 1; if (!first[k]) first[k] = a; } });
    return groupBy(posts, function (p) {
      var a = norm(p), k = a.toLowerCase();
      if (!a) return '\u0001plain';
      return cnt[k] >= 2 ? k : '\u0001other';
    }, function (p, k) {
      return k === '\u0001plain' ? '一般貼文（沒填活動名稱）' : (k === '\u0001other' ? '其他活動（各 1 則）' : first[k]);
    });
  }
  var TABS = {
    channel: { label: '平台', fn: byChannel, ordered: false, hint: '' },
    type: { label: '內容類型', fn: byType, ordered: false, hint: '內容類型和平台常常綁在一起（例如 LINE 多半在推活動），兩者的差異不容易拆開。' },
    weekday: { label: '發文星期', fn: byWeekday, ordered: true, hint: '每個星期只有幾則貼文，差異多半是隨機波動（或剛好那幾天發了熱門商品），只能當參考，不要據此改發文日。' },
    activity: { label: '活動主題', fn: byActivity, ordered: false, hint: '同一個活動主題通常混著不同平台和商品，比較時要留意。' }
  };

  /* ---- 排序：樣本夠的依指標由大到小，樣本少的另外放後面 ---- */
  function orderGroups(groups, metric, keepOrder) {
    if (keepOrder) return { main: groups.slice(), low: [], all: groups.slice() };     // 星期這種有天然順序的：照順序，樣本少只在該列標示
    var main = groups.filter(function (g) { return !g.low; }), low = groups.filter(function (g) { return g.low; });
    var cmp = function (a, b) {
      var av = a[metric], bv = b[metric];
      if (av == null && bv == null) return b.visits - a.visits;
      if (av == null) return 1; if (bv == null) return -1;
      return bv - av || b.visits - a.visits;
    };
    main.sort(cmp);
    low.sort(cmp);
    return { main: main, low: low, all: main.concat(low) };
  }
  // 長條比例尺的最大值：只看樣本夠的列（樣本少的列極端值不該決定整張圖的尺度；超過就在 barPct 封頂 100）
  function barMax(groups, metric) {
    var pick = function (list) { return list.reduce(function (a, g) { return g[metric] != null && g[metric] > a ? g[metric] : a; }, 0); };
    var m = pick(groups.filter(function (g) { return !g.low; }));
    return m > 0 ? m : pick(groups);
  }
  // 長條要畫多長（0–100）：max 當 100，找不到就 0
  function barPct(v, max) { return v == null || !(max > 0) ? 0 : Math.max(v > 0 ? 1 : 0, Math.min(100, v / max * 100)); }
  // 領先標示：樣本夠；轉換率／營收類還要有足夠的購買筆數，否則 1～2 筆購買就會把比率推到最高
  function leaderKey(groups, metric) {
    var needBuys = metric === 'cvr' || metric === 'avgRev', best = null;
    groups.forEach(function (g) {
      if (g.low || g[metric] == null || !(g[metric] > 0)) return;
      if (needBuys && g.buys < MIN_BUYS) return;
      if (!best || g[metric] > best[metric]) best = g;
    });
    return best ? best.key : null;
  }

  /* ---- 單則貼文排行 ---- */
  var SORTS = {
    sessions: { label: '造訪', get: function (p) { return num(p.sessions); } },
    purchases: { label: '購買', get: function (p) { return num(p.purchases); } },
    revenue: { label: '營收', get: function (p) { return num(p.revenue); } },
    cvr: { label: '轉換率', get: function (p) { return num(p.sessions) >= MIN_VISITS ? num(p.purchases) / num(p.sessions) : -1; }, note: '造訪 ≥ ' + MIN_VISITS + ' 才排' },
    date: { label: '最新', get: function (p) { return p.date; } }
  };
  function rankPosts(posts, sortKey) {
    var s = SORTS[sortKey] || SORTS.sessions;
    return (posts || []).slice().sort(function (a, b) {
      var av = s.get(a), bv = s.get(b);
      if (av === bv) return num(b.purchases) - num(a.purchases) || num(b.sessions) - num(a.sessions);
      return av < bv ? 1 : -1;
    });
  }
  function postRates(p) {
    return { engRate: div(num(p.engaged) * 100, num(p.sessions)), cvr: div(num(p.purchases) * 100, num(p.sessions)) };
  }

  return {
    MIN_AGE: MIN_AGE, MIN_POSTS: MIN_POSTS, MIN_VISITS: MIN_VISITS, MIN_BUYS: MIN_BUYS, WEEKDAYS: WEEKDAYS, METRICS: METRICS, TABS: TABS, SORTS: SORTS,
    filterPosts: filterPosts, totals: totals, groupBy: groupBy, byChannel: byChannel, byType: byType, byWeekday: byWeekday, byActivity: byActivity,
    orderGroups: orderGroups, barMax: barMax, barPct: barPct, leaderKey: leaderKey, rankPosts: rankPosts, postRates: postRates,
    fmtInt: fmtInt, fmtPct: fmtPct, fmtMoney: fmtMoney, fmtMetric: fmtMetric
  };
});
