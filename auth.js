/**
 * auth.js — 林果良品 dashboard.oringo.tw 登入保護層
 * 策略：@oringoshoes.com 網域 Google 帳號才可進入
 * 登入狀態存 localStorage，關閉分頁後重新驗證
 */
(function () {
  const CLIENT_ID = '777948523832-8qfmjk689e35f02crqjp35kg47j4kcgn.apps.googleusercontent.com';
  const ALLOWED_DOMAIN = 'oringoshoes.com';
  const SESSION_KEY = 'oringo_auth_v1';
  const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 小時

  /* ── 0. 頁面自行宣告免登入（例如客人自助查詢連結）→ 直接放行 ── */
  if (window.ORINGO_SKIP_AUTH) return;

  const ALWAYS_ALLOW = new Set(['gary@oringoshoes.com']); // 保底：管理員永不被鎖在外

  /* ── 1. 檢查 session ── */
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }
  function isSessionValid() {
    const d = getSession();
    // 純名單制：登入時已驗證在名單內，session 只看有效期（不再限公司網域）
    return !!(d && d.exp > Date.now() && d.email);
  }

  function saveSession(email, perms, idToken) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      email: email.toLowerCase(),
      perms: perms || null,
      exp: Date.now() + SESSION_TTL,
      idToken: idToken || null
    }));
  }

  /* ── 逐頁權限：只有財務頁需要額外授權，其他頁面名單內即可看 ── */
  const PAGE_ID_OF_FILE = {
    'finance.html': 'finance'
  };
  function currentPageId() {
    const f = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    return PAGE_ID_OF_FILE[f] || null;
  }
  function showAccessDenied() {
    document.getElementById('auth-hide-style')?.remove();
    const hs = document.createElement('style');
    hs.textContent = 'body > *:not(#access-denied){display:none!important}';
    document.head.appendChild(hs);
    const mount = () => {
      const el = document.createElement('div');
      el.id = 'access-denied';
      el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#002721;color:#E2CEB9;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:"Noto Sans TC",sans-serif;text-align:center;padding:24px';
      el.innerHTML = '<div style="font-size:2.6rem;margin-bottom:14px">🔒</div>'
        + '<div style="font-size:1.15rem;font-weight:700;margin-bottom:8px">此頁面沒有開放給你的角色</div>'
        + '<div style="font-size:.9rem;color:#CFA294;line-height:1.7">如需存取請洽 Gary 調整角色權限。<br><a href="/" style="color:#E2CEB9">← 回中控中心</a></div>';
      document.body.appendChild(el);
    };
    // 已登入的人重新整理時，auth.js 在 <head> 執行、body 還沒出現（原本直接 appendChild 會丟錯，財務頁變一片空白）
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
  function enforcePagePermission(perms) {
    const pid = currentPageId();
    if (!pid) return;                                   // 非受控頁 → 放行
    if (ALWAYS_ALLOW.has((getSession() || {}).email)) return; // 管理員全放行
    if (perms && perms[pid] === false) showAccessDenied(); // 明確無權才擋（未設定＝放行）
  }

  /* ── 2. 已登入 → 逐頁權限檢查後放行 ── */
  if (isSessionValid()) { enforcePagePermission((getSession() || {}).perms); return; }

  /* ── 3. 未登入 → 立即隱藏頁面內容（防閃爍）── */
  const hideStyle = document.createElement('style');
  hideStyle.id = 'auth-hide-style';
  hideStyle.textContent = 'body > *:not(#auth-overlay){display:none!important}';
  document.head.appendChild(hideStyle);

  /* ── 4. 解析 Google JWT（不做 signature 驗證，Google 已驗過）── */
  function decodeJWT(token) {
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(
        atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
      ));
    } catch { return {}; }
  }

  /* ── 登入規則：@oringoshoes.com 一律放行；admin.html 的名單只用來設「例外與權限」（2026-10-27 Gary 定）── */
  const PERM_GAS_URL = 'https://script.google.com/macros/s/AKfycbyno4dWC9uaZjiCLYRqAJf7HrX8fUsOnqU6R0giYNBq1ECE3lkBOV5GZJmZwGIyC93Jbw/exec';
  const ALLOWLIST_CACHE = 'oringo_allowlist_v1';
  const ADMIN_PERMS = { finance: true };
  const DEFAULT_PERMS = { finance: false }; // 名單外的公司帳號：可看一般儀表板，財務頁要名單授權（財務頁自己另有後端驗證）

  let denyReason = ''; // 'disabled' 名單明確停用｜'unlisted' 非公司網域又不在名單｜'down' 名單讀不到且無從判斷（用來顯示對的訊息）

  // 回傳使用者物件（含 perms）或 null。規則：
  //  ① 名單內且被明確停用 → 擋
  //  ② 名單內（啟用）→ 放行，權限用名單的
  //  ③ 名單外：@oringoshoes.com → 放行（預設權限）；其他網域 → 擋（只有名單內的非公司帳號能進，例如私人 Gmail 的同事）
  // 名單後端連不上／回錯誤時，①②用瀏覽器快取的名單，沒有快取就只看網域——公司同事不會因為名單後端的問題被擋在外面。
  async function resolveUser(email) {
    denyReason = '';
    if (ALWAYS_ALLOW.has(email)) return { email, perms: ADMIN_PERMS };
    const inDomain = email.endsWith('@' + ALLOWED_DOMAIN);
    let listDown = false;
    const decide = (entry) => {
      if (entry) {
        if (entry.active === false) { denyReason = 'disabled'; return null; }
        return { email, perms: entry.perms || null };
      }
      if (inDomain) return { email, perms: DEFAULT_PERMS };
      denyReason = listDown ? 'down' : 'unlisted';
      return null;
    };
    try {
      const res = await fetch(PERM_GAS_URL + '?action=getUsers');
      const data = await res.json();
      // 後端會回 HTTP 200 的 {error:…}（例如 GAS 授權過期）：那不是名單，要當成後端故障，不能當成「名單是空的」（2026-10-27 事故）
      if (!data || !Array.isArray(data.users)) throw new Error((data && data.error) || '名單格式異常');
      const users = data.users.map(u => ({ email: (u.email || '').toLowerCase(), perms: u.perms || null, active: u.active !== false }));
      // 快取（含 perms 與停用狀態）供後端斷線時使用
      try { localStorage.setItem(ALLOWLIST_CACHE, JSON.stringify(users)); } catch {}
      return decide(users.find(u => u.email === email));
    } catch (e) {
      console.warn('權限名單查詢失敗，改用快取名單', e);
      listDown = true;
      let entry = null;
      try {
        const cached = JSON.parse(localStorage.getItem(ALLOWLIST_CACHE) || 'null');
        if (Array.isArray(cached)) {
          entry = cached.find(x => x && x.email === email) || null;
          if (!entry && cached.includes(email)) entry = { email, perms: null, active: true }; // 舊版快取是純 email 陣列
        }
      } catch {}
      return decide(entry);
    }
  }

  function showAuthError(msg) {
    const errEl = document.getElementById('auth-error');
    if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
  }

  /* ── 5. 登入回呼 ── */
  window._oriAuthCallback = async function (response) {
    const payload = decodeJWT(response.credential);
    const email = (payload.email || '').toLowerCase();
    if (!email) { showAuthError('⚠️ 無法取得帳號，請重試。'); return; }
    // 公司網域（@oringoshoes.com）直接放行；非公司帳號要在 admin.html 名單內；名單內明確停用的人一律擋
    const user = await resolveUser(email);
    if (!user) {
      showAuthError(denyReason === 'disabled'
        ? '⚠️ 帳號 ' + email + ' 已被停用，請洽 Gary。'
        : denyReason === 'down'
          ? '⚠️ 權限名單暫時讀不到，無法確認 ' + email + ' 是否已開通，請稍後再試，或洽 Gary。'
          : '⚠️ 帳號 ' + email + ' 不是公司帳號（@oringoshoes.com），也不在開通名單內，請洽 Gary 開通。');
      return;
    }
    saveSession(email, user.perms, response.credential);
    document.getElementById('auth-overlay')?.remove();
    document.getElementById('auth-hide-style')?.remove();
    // 通知其他頁面邏輯（如 finance.html 的二次授權）
    document.dispatchEvent(new CustomEvent('oriAuthComplete', { detail: { email } }));
    // 若登入的頁面本身不開放此角色，直接擋下
    enforcePagePermission(user.perms);
  };

  /* ── 6. 建立登入覆蓋層 ── */
  function buildOverlay() {
    const el = document.createElement('div');
    el.id = 'auth-overlay';
    el.innerHTML = `
<style>
#auth-overlay{
  position:fixed;inset:0;z-index:99999;
  background:#002721;
  display:flex;flex-direction:column;
  align-items:center;justify-content:center;
  font-family:'Noto Sans TC',sans-serif;
}
#auth-overlay .ao-brand{
  color:#E2CEB9;font-size:1.55rem;font-weight:700;
  letter-spacing:.18em;margin-bottom:6px;
}
#auth-overlay .ao-sub{
  color:#CFA294;font-size:.8rem;letter-spacing:.12em;margin-bottom:44px;
}
#auth-overlay .ao-card{
  background:#fff;border-radius:20px;
  padding:44px 52px;text-align:center;
  box-shadow:0 12px 48px rgba(0,0,0,.35);
  min-width:300px;max-width:380px;
}
#auth-overlay .ao-card h2{
  color:#284234;font-size:1.05rem;font-weight:700;margin-bottom:8px;
}
#auth-overlay .ao-card p{
  color:#666;font-size:.82rem;line-height:1.7;margin-bottom:28px;
}
#auth-overlay .ao-btn-wrap{display:flex;justify-content:center;}
#auth-error{
  color:#A54A1A;font-size:.8rem;margin-top:18px;
  line-height:1.5;display:none;
}
</style>
<div class="ao-brand">林果良品</div>
<div class="ao-sub">ORINGO 營運中控</div>
<div class="ao-card">
  <h2>員工登入</h2>
  <p>此頁面僅供內部人員使用<br>請以 @oringoshoes.com 帳號登入</p>
  <div id="g_id_onload"
    data-client_id="${CLIENT_ID}"
    data-callback="_oriAuthCallback"
    data-auto_prompt="false">
  </div>
  <div class="ao-btn-wrap">
    <div class="g_id_signin"
      data-type="standard"
      data-size="large"
      data-theme="outline"
      data-text="sign_in_with"
      data-locale="zh-TW">
    </div>
  </div>
  <div id="auth-error"></div>
</div>`;
    document.body.prepend(el);
  }

  /* ── 7. 載入 GSI + 顯示 overlay ── */
  function init() {
    buildOverlay();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ── 8. 公開登出方法（header 登出按鈕用）── */
  window.oriAuthLogout = function () {
    localStorage.removeItem(SESSION_KEY);
    location.reload();
  };
})();
