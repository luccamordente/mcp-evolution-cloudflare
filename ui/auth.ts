import { ptBR } from '@clerk/localizations';
import type { Clerk } from '@clerk/clerk-js';

declare global {
  interface Window { __internal_ClerkUICtor: NonNullable<NonNullable<Parameters<Clerk['load']>[0]>['ui']>['ClerkUI'] }
}

async function start() {
  const element = document.getElementById('wapilot-auth-config');
  if (!element) return;
  const config = JSON.parse(element.textContent ?? '{}') as { mode: string; returnTo: string };
  const status = document.getElementById('wapilot-auth-status') ?? document.getElementById('wapilot-session-status');
  const notify = (message: string) => {
    if (!status) return;
    status.textContent = message;
    if (config.mode === 'session') { const link = document.createElement('a'); link.href = '/sign-in?' + new URLSearchParams({ returnTo: config.returnTo }); link.textContent = ' Entrar novamente'; status.append(link); }
  };
  try {
    const clerk = window.Clerk;
    if (!clerk || !window.__internal_ClerkUICtor) throw new Error();
    await clerk.load({ localization: ptBR, ui: { ClerkUI: window.__internal_ClerkUICtor }, signInUrl: '/sign-in', signUpUrl: '/accept-invitation', signInForceRedirectUrl: config.returnTo, signUpForceRedirectUrl: '/connections', telemetry: { disabled: true } });
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-wapilot-signout]')) {
      button.hidden = !clerk.session;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await clerk.signOut({ redirectUrl: '/sign-in' }); }
        catch { button.disabled = false; notify('Não foi possível sair. Tente novamente.'); }
      });
    }
    if (config.mode === 'session') {
      clerk.addListener(({ session }) => { if (!session) notify('Sua sessão expirou. Entre novamente para continuar.'); });
      document.addEventListener('wapilot:session-expired', () => notify('Sua sessão expirou. Entre novamente para continuar.'));
      return;
    }
    if (config.mode === 'message') return;
    if (clerk.session) { window.location.replace(config.returnTo); return; }
    const target = document.getElementById('clerk-auth') as HTMLDivElement | null;
    if (!target) return;
    if (config.mode === 'invitation') {
      if (!new URL(window.location.href).searchParams.get('__clerk_ticket')) { notify('Este convite é inválido ou expirou. Peça um novo convite a um administrador.'); return; }
      clerk.mountSignUp(target, { routing: 'hash', forceRedirectUrl: '/connections', signInUrl: '/sign-in' });
    } else {
      clerk.mountSignIn(target, { routing: 'hash', forceRedirectUrl: config.returnTo, signUpUrl: '/accept-invitation', withSignUp: false });
    }
  } catch { notify('Não foi possível carregar o acesso ao WaPilot. Tente novamente em instantes.'); }
}

void start();
