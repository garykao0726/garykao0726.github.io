/**
 * staff-session.js — 員工後台通行證（維修／訂製／退貨頁共用，2026-10-27）
 *
 * 問題：後台（GAS）要驗證「這是不是 @oringoshoes.com 的人」。原本每個頁面都要拿一組 Google access token（只活 1 小時），
 *   而瀏覽器擋「沒點擊就彈出」的授權視窗，所以員工每換一頁、每過一小時都要按一次橘色授權橫幅。
 * 做法（依序嘗試，前面成功就不會打擾員工）：
 *   ① 快取的通行證（localStorage，綁登入帳號，後台簽發，8 小時）
 *   ② 用儀表板登入時存下的 Google ID token（1 小時內有效）向後台換通行證 → 沒有任何彈窗
 *   ③ 都不行才顯示橫幅，點一次：Google access token → 向後台換通行證（之後 8 小時都不用再點）
 *   後台還不認得通行證（舊版）時，③ 會退回直接用 access token（舊流程，1 小時）。
 *
 * 用法：OringoStaffSession.start({ gasUrl, bannerText, onToken(token) })；後台說憑證無效時呼叫 OringoStaffSession.refresh()。
 * onToken 會在每次拿到新憑證時被呼叫（包含員工點橫幅之後），頁面在裡面（重新）載入資料。
 */
(function () {
  const CLIENT_ID = '777948523832-8qfmjk689e35f02crqjp35kg47j4kcgn.apps.googleusercontent.com';
  const AUTH_KEY = 'oringo_auth_v1';            // auth.js 的登入 session（含 idToken）
  const OLD_CACHE_KEY = 'oringo_staff_token_v1'; // 2026-10-27 上午版本的 1 小時 access token 快取，已淘汰
  const REFRESH_COOLDOWN_MS = 30000;

  let cfg = null;
  let tokenClient = null;
  let busy = null;
  let lastRefreshAt = 0;

  function readAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
  }
  function dashEmail() { const a = readAuth(); return (a && a.email) || ''; }

  // 快取以後台網址區分（維修／訂製共用同一個後台，退貨是另一個）
  function cacheKey() { return 'oringo_staff_session_v1:' + String(cfg.gasUrl || '').replace(/\/exec.*$/, '').slice(-20); }
  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
      if (c && c.token && c.exp > Date.now() + 300000 && c.email && c.email === dashEmail()) return c;
    } catch (e) {}
    return null;
  }
  function writeCache(token, expMs, kind) {
    try { localStorage.setItem(cacheKey(), JSON.stringify({ token: token, exp: expMs, email: dashEmail(), kind: kind })); } catch (e) {}
  }
  function clearCache() { try { localStorage.removeItem(cacheKey()); } catch (e) {} }

  function jwtExpMs(jwt) {
    try {
      let b = String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return Number(JSON.parse(atob(b)).exp) * 1000;
    } catch (e) { return 0; }
  }

  // 向後台換通行證；任何失敗（舊版後台不認得 staffLogin、退貨後台尚未授權回 403 網頁、憑證無效…）都回 null，由呼叫端走下一條路
  async function exchange(body) {
    try {
      const r = await fetch(cfg.gasUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'staffLogin' }, body)) });
      const d = await r.json();
      if (d && d.success && d.session) return { token: d.session, expMs: Number(d.exp) * 1000 };
    } catch (e) {}
    return null;
  }

  function hideBanner() {
    const el = document.getElementById('staff-auth-banner');
    if (el) el.remove();
  }
  function deliver(token, expMs, kind) {
    writeCache(token, expMs, kind);
    hideBanner();
    cfg.onToken(token);
  }

  function loadGsi() {
    return new Promise(function (resolve) {
      if (window.google && google.accounts && google.accounts.oauth2) { resolve(true); return; }
      // auth.js 在登入 session 仍有效時不會載入 GSI，這裡自己補載
      if (!document.getElementById('gsi-client-script')) {
        const s = document.createElement('script');
        s.id = 'gsi-client-script';
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        document.head.appendChild(s);
      }
      let tries = 0;
      const t = setInterval(function () {
        if (window.google && google.accounts && google.accounts.oauth2) { clearInterval(t); resolve(true); }
        else if (++tries > 75) { clearInterval(t); resolve(false); }
      }, 200);
    });
  }

  function initClient() {
    if (tokenClient) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'openid email profile',
      hint: dashEmail() || undefined,
      callback: async function (resp) {
        if (!resp || resp.error || !resp.access_token) return; // 員工關掉視窗：橫幅留著
        const s = await exchange({ accessToken: resp.access_token });
        if (s) deliver(s.token, s.expMs, 'session');
        else deliver(resp.access_token, Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 120000, 'access'); // 後台不認得通行證：舊流程
      },
      error_callback: function () {},
    });
  }

  function requestFromGoogle() {
    // 已同意過就不會再跳完整同意畫面；橫幅顯示時就預先載入好 GSI，點下去才有使用者手勢可以開視窗
    if (tokenClient) { tokenClient.requestAccessToken({ prompt: '' }); return; }
    loadGsi().then(function (ok) { if (ok) { initClient(); tokenClient.requestAccessToken({ prompt: '' }); } });
  }

  function showBanner() {
    if (document.getElementById('staff-auth-banner')) return;
    const el = document.createElement('div');
    el.id = 'staff-auth-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99997;background:#A54A1A;color:#fff;padding:10px 16px;text-align:center;font-size:13px;cursor:pointer';
    el.textContent = cfg.bannerText || '⚠ 需要額外授權才能存取後台資料，點此授權';
    el.onclick = requestFromGoogle;
    document.body.prepend(el);
    loadGsi().then(function (ok) { if (ok) initClient(); });
  }

  async function tryIdToken() {
    const a = readAuth();
    if (!a || !a.idToken || jwtExpMs(a.idToken) < Date.now() + 60000) return false; // 登入超過 1 小時，ID token 已過期
    const s = await exchange({ idToken: a.idToken });
    if (!s) return false;
    deliver(s.token, s.expMs, 'session');
    return true;
  }

  async function acquire() {
    const c = readCache();
    if (c) { hideBanner(); cfg.onToken(c.token); return true; }
    if (await tryIdToken()) return true;
    showBanner();
    return false;
  }

  function start(options) {
    cfg = options;
    try { localStorage.removeItem(OLD_CACHE_KEY); } catch (e) {}
    return acquire();
  }

  // 後台說憑證無效／過期：丟掉快取重新取得。30 秒內只做一次，避免後台一直拒絕時無限重試（之後直接顯示橫幅）
  function refresh() {
    if (!cfg) return Promise.resolve(false);
    if (busy) return busy;
    clearCache();
    if (Date.now() - lastRefreshAt < REFRESH_COOLDOWN_MS) { showBanner(); return Promise.resolve(false); }
    lastRefreshAt = Date.now();
    busy = acquire().then(function (ok) { busy = null; return ok; }, function () { busy = null; return false; });
    return busy;
  }

  window.OringoStaffSession = { start: start, refresh: refresh, clear: function () { if (cfg) clearCache(); } };
})();
