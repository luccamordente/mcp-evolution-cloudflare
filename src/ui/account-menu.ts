import { sessionSignOut } from './auth';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export function accountMenu(email: string): string {
  const [initial = '—'] = email;
  return `<details class="account" id="account">
        <summary class="account-trigger" aria-label="Minha conta"><span class="account-avatar" aria-hidden="true">${escapeHtml(initial.toUpperCase())}</span><span class="account-label">Minha conta</span><span class="account-caret" aria-hidden="true"></span></summary>
        <div class="account-panel">
          <p class="account-details">Conectado como <strong class="account-email">${escapeHtml(email)}</strong></p>
          ${sessionSignOut('Sair')}
          <div id="wapilot-signout-status" role="status"></div>
        </div>
      </details>`;
}

export const accountMenuStyles = `
    .account { position:relative; justify-self:end; }
    .account-trigger { display:flex; align-items:center; gap:8px; min-height:44px; padding:5px 11px 5px 5px; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:999px; cursor:pointer; font-size:13px; font-weight:700; white-space:nowrap; list-style:none; }
    .account-trigger::-webkit-details-marker { display:none; }
    .account-trigger:hover, .account[open] .account-trigger { background:var(--mint); border-color:#b8d8c3; }
    .account-trigger:focus-visible { outline:3px solid var(--green-deep); outline-offset:3px; }
    .account-avatar { display:grid; place-items:center; width:32px; height:32px; color:var(--green-deep); background:var(--mint-strong); border-radius:50%; font-size:12px; font-weight:800; }
    .account-caret { display:grid; place-items:center; width:13px; height:13px; color:var(--muted); }
    .account-caret::before { content:""; width:6px; height:6px; border:solid currentColor; border-width:0 1.5px 1.5px 0; transform:translateY(-1.5px) rotate(45deg); }
    .account[open] .account-caret { transform:rotate(180deg); }
    .account-panel { position:absolute; z-index:21; inset-block-start:calc(100% + 9px); inset-inline-end:0; width:min(280px, calc(100vw - 32px)); padding:6px; background:var(--surface); border:1px solid var(--line); border-radius:15px; box-shadow:0 20px 44px rgba(16,32,25,.16); }
    .account-details { margin:0; padding:8px 12px 10px; color:var(--muted); font-size:12px; }
    .account-email { display:block; margin-top:3px; color:var(--ink); font-size:14px; overflow-wrap:anywhere; }
    .account-panel [data-wapilot-signout] { width:100%; min-height:44px; padding:9px 12px; color:var(--ink); background:transparent; border:0; border-radius:9px; text-align:left; font-size:14px; font-weight:700; }
    .account-panel [data-wapilot-signout]:hover { background:var(--mint); }
    .account-panel [data-wapilot-signout]:focus-visible { outline:2px solid var(--green-deep); outline-offset:-2px; }
    .account-panel [data-wapilot-signout]:disabled { color:var(--muted); cursor:wait; }
    #wapilot-signout-status:not(:empty) { padding:4px 12px 8px; color:var(--red); font-size:13px; }
    @media (max-width:520px) { .account-label { display:none; } }
`;

export const accountMenuScript = `<script>
    (() => {
      const account = document.querySelector('#account');
      const closeAccountOnOutsideInteraction = (event) => {
        if (!account.contains(event.target)) account.open = false;
      };
      document.addEventListener('focusin', closeAccountOnOutsideInteraction);
      document.addEventListener('click', closeAccountOnOutsideInteraction);
      account.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !account.open) return;
        account.open = false;
        account.querySelector('summary').focus();
      });
    })();
  </script>`;
