import { WAPILOT_LOGO_SVG } from './wapilot-logo';

export function authScripts(publishableKey: string, frontend: string, mode: string, returnTo: string): string {
  const config = JSON.stringify({ publishableKey, mode, returnTo }).replace(/</g, '\\u003c');
  return `<script type="application/json" id="wapilot-auth-config">${config}</script>
<script defer crossorigin="anonymous" src="${frontend}/npm/@clerk/ui@1.42.5/dist/ui.browser.js"></script>
<script defer crossorigin="anonymous" data-clerk-publishable-key="${publishableKey}" src="${frontend}/npm/@clerk/clerk-js@6.43.0/dist/clerk.browser.js"></script>
<script defer src="/auth.js"></script>`;
}

export const SESSION_CONTROL = '<button type="button" data-wapilot-signout hidden>Sair do navegador</button><span id="wapilot-session-status" role="status"></span>';

export function authPage(title: string, description: string, scripts: string, mount = false): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>WaPilot · Acesso</title>
<style>body{margin:0;background:#f7faf9;color:#0f1b25;font:1rem/1.5 system-ui,sans-serif}main{max-width:30rem;margin:8vh auto;padding:1.5rem}header{display:flex;align-items:center;justify-content:space-between;gap:1rem}header svg{width:9rem;height:auto}h1{font-size:2rem;line-height:1.15}button,a{font:inherit}button{min-height:48px;padding:.65rem 1rem;border:1px solid #108b45;border-radius:.75rem;background:white;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #108b45;outline-offset:3px}#clerk-auth{margin-block:1.5rem}#wapilot-auth-status{color:#486052}</style>${scripts}</head><body><main><header><a href="/connections" aria-label="WaPilot">${WAPILOT_LOGO_SVG}</a>${SESSION_CONTROL}</header><h1>${title}</h1><p>${description}</p><p id="wapilot-auth-status" role="status" aria-live="polite"></p>${mount ? '<div id="clerk-auth"></div>' : ''}<p>O acesso ao WaPilot depende de convite e ativação por um administrador.</p><noscript>Ative o JavaScript para entrar no WaPilot.</noscript></main></body></html>`;
}
