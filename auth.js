/**
 * auth.js — 林果良品 dashboard.oringo.tw 登入保護層
 * 策略：@oringoshoes.com 網域 Google 帳號才可進入
 * 登入狀態存 sessionStorage，關閉分頁後重新驗證
 */
(function () {
  const CLIENT_ID = '901817647731-nsjtqdurcnp6mf40mtltkmn01me3ss93.apps.googleusercontent.com';
  const ALLOWED_DOMAIN = 'oringoshoes.com';
  const SESSION_KEY = 'oringo_auth_v1';
  const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 小時

  /* ── 1. 檢查 session ── */
  function isSessionValid() {
    try {
      const d = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return d && d.exp > Date.now() && (d.email || '').toLowerCase().endsWith('@' + ALLOWED_DOMAIN);
    } catch { return false; }
  }

  function saveSession(email) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      email: email.toLowerCase(),
      exp: Date.now() + SESSION_TTL
    }));
  }

  /* ── 2. 已登入 → 直接放行 ── */
  if (isSessionValid()) return;

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

  /* ── 5. 登入回呼 ── */
  window._oriAuthCallback = function (response) {
    const payload = decodeJWT(response.credential);
    const email = (payload.email || '').toLowerCase();
    if (email.endsWith('@' + ALLOWED_DOMAIN)) {
      saveSession(email);
      document.getElementById('auth-overlay')?.remove();
      document.getElementById('auth-hide-style')?.remove();
      // 通知其他頁面邏輯（如 finance.html 的二次授權）
      document.dispatchEvent(new CustomEvent('oriAuthComplete', { detail: { email } }));
    } else {
      const errEl = document.getElementById('auth-error');
      if (errEl) {
        errEl.textContent = '⚠️ 帳號 ' + email + ' 無存取權限，請使用 @oringoshoes.com 帳號登入。';
        errEl.style.display = 'block';
      }
    }
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
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  };
})();
