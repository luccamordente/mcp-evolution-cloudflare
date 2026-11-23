import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { connectionsPage } from '../src/ui/connections';

const connected = { id: 'one', friendlyName: 'Fixture', state: 'connected', isDefault: true };
const qr = 'data:image/png;base64,c3ludGhldGljLXFy';

function openWorkspace(fetcher: typeof fetch, hash = 'dashboard') {
  return new JSDOM(connectionsPage({ id: 'user-1', email: 'user@example.test', claims: {} }), {
    url: 'https://example.test/connections#' + hash,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = fetcher as typeof window.fetch;
      window.document.cookie = '__Host-wapilot_csrf=fixture-csrf; Secure; Path=/';
    },
  });
}

it('keeps browser sign-out inside the account disclosure and session messages outside the header', () => {
  const dom = openWorkspace(async input => Response.json(String(input) === '/connections/data'
    ? { connections: [connected] }
    : { authorizations: [] }));
  try {
    const { document, KeyboardEvent } = dom.window;
    const account = document.querySelector<HTMLDetailsElement>('.topbar .account')!;
    const trigger = account.querySelector('summary')!;
    const signOut = account.querySelector<HTMLButtonElement>('[data-wapilot-signout]')!;
    const connectionTrigger = document.querySelector<HTMLButtonElement>('#context-trigger')!;

    expect(account.open).toBe(false);
    expect(trigger.textContent).toContain('Minha conta');
    expect(account.querySelector('.account-email')?.textContent).toBe('user@example.test');
    expect(signOut.textContent).toBe('Sair');
    expect(signOut.hidden).toBe(true);
    expect(account.querySelector('#wapilot-signout-status')?.getAttribute('role')).toBe('status');
    expect(document.querySelector('main #wapilot-session-status')).not.toBeNull();

    trigger.click();
    signOut.hidden = false;
    signOut.focus();
    expect(account.open).toBe(true);
    signOut.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(account.open).toBe(false);
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    connectionTrigger.click();
    expect(account.open).toBe(false);
    expect(connectionTrigger.getAttribute('aria-expanded')).toBe('true');
    trigger.click();
    expect(account.open).toBe(true);
    expect(connectionTrigger.getAttribute('aria-expanded')).toBe('false');
  } finally { dom.window.close(); }
});

describe('continuing an existing connection awaiting QR', () => {
  function workspace(connectionQr?: string, hash = 'dashboard') {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/connections/data') return Response.json({ connections: [
        { id: 'one', friendlyName: 'Fixture', state: 'qr', isDefault: true, qr: connectionQr, qrExpiresIn: 17 },
      ] });
      if (path === '/connections/authorizations') return Response.json({ authorizations: [] });
      if (path === '/connections/api/connections/one/qr' && init?.method === 'POST') return Response.json({ qr, expiresIn: 17 });
      if (path === '/connections/api/connections/one/status') return Response.json({ state: 'qr' });
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${path}`);
    });
    return { dom: openWorkspace(fetcher, hash), fetcher };
  }

  it.each(['dashboard', 'onboarding'])('does not start pairing on initial #%s loading', async (hash) => {
    const { dom, fetcher } = workspace(undefined, hash);
    try {
      const { document } = dom.window;
      await vi.waitFor(() => expect(document.querySelector('#context-label')?.textContent).toBe('Fixture'));
      expect(document.querySelector<HTMLElement>('#onboarding-view')!.hidden).toBe(hash === 'dashboard');
      expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
      expect((dom.window.document.querySelector('#qr-image') as HTMLImageElement).hidden).toBe(true);
    } finally { dom.window.close(); }
  });

  describe.each(['[data-open="one"]', '[data-select="one"]'])('via %s', (selector) => {
    it.each([false, true])('shows the QR without an extra reload (QR already available: %s)', async (hasQr) => {
      const { dom, fetcher } = workspace(hasQr ? qr : undefined);
      try {
        await vi.waitFor(() => expect(dom.window.document.querySelector(selector)).not.toBeNull());
        (dom.window.document.querySelector(selector) as HTMLElement).click();
        const image = dom.window.document.querySelector('#qr-image') as HTMLImageElement;
        await vi.waitFor(() => expect(image.hidden).toBe(false));
        expect(image.src).toBe(qr);
        const placeholder = dom.window.document.querySelector<HTMLElement>('#qr-placeholder')!;
        expect(placeholder.hidden).toBe(true);
        expect(dom.window.getComputedStyle(placeholder).display).toBe('none');
        expect(dom.window.document.querySelector('#countdown')?.textContent).toBe('00:17');
        const mutations = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
        expect(mutations.map(([path]) => path)).toEqual(hasQr ? [] : ['/connections/api/connections/one/qr']);
      } finally { dom.window.close(); }
    });
  });
});

it('describes the dashboard according to whether a connection exists', async () => {
  for (const connections of [[], [connected]]) {
    const dom = openWorkspace(async input => {
      if (String(input) === '/connections/data') return Response.json({ connections });
      return Response.json({ authorizations: [] });
    });
    try {
      const { document } = dom.window;
      if (!connections.length) {
        await vi.waitFor(() => expect(document.querySelector<HTMLElement>('#onboarding-view')!.hidden).toBe(false));
        document.querySelector<HTMLElement>('#back-dashboard')!.click();
      }
      await vi.waitFor(() => expect(document.querySelector('#dashboard-title')?.textContent).toBe(connections.length
        ? 'Seu WhatsApp está pronto para trabalhar.'
        : 'Suas conexões no WaPilot.'));
      expect(document.title).toBe('WaPilot · Conexões');
    } finally { dom.window.close(); }
  }
});

it('loads and collapses additional activity and shows when a dashboard request needs sign-in', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    switch (String(input)) {
      case '/connections/data':
        return Response.json({ connections: [{ ...connected, activity: [{ title: 'Atividade recente da fixture' }] }] });
      case '/connections/authorizations':
        return Response.json({ authorizations: [] });
      case '/connections/activity/one':
        return Response.json({ activity: [{ title: 'Atividade recente da fixture' }, { title: 'Atividade anterior da fixture' }] });
      case '/connections/data?refresh=1':
        return new Response(null, { status: 401 });
      default:
        throw new Error('Unexpected request: ' + input);
    }
  });
  const dom = openWorkspace(fetcher);
  try {
    const { document } = dom.window;
    const activityButton = () => document.querySelector<HTMLButtonElement>('[data-activity="one"]')!;
    const activity = () => document.querySelector('.activity-list')?.textContent;
    await vi.waitFor(() => expect(activityButton()?.textContent).toContain('Ver tudo'));
    expect(activity()).not.toContain('Atividade anterior da fixture');
    activityButton().click();
    await vi.waitFor(() => expect(activity()).toContain('Atividade anterior da fixture'));
    expect(activityButton().textContent).toContain('Ver menos');
    activityButton().click();
    expect(activity()).not.toContain('Atividade anterior da fixture');
    expect(fetcher.mock.calls.filter(([path]) => path === '/connections/activity/one')).toHaveLength(1);

    document.querySelector<HTMLButtonElement>('[data-refresh="one"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('#toast')?.textContent).toContain('Sua sessão expirou.'));
    expect(fetcher).toHaveBeenLastCalledWith('/connections/data?refresh=1', expect.objectContaining({ redirect: 'manual' }));
  } finally { dom.window.close(); }
});

it('preserves the selected connection while preparing a new one', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    switch (String(input)) {
      case '/connections/data':
        return Response.json({ connections: [connected] });
      case '/connections/authorizations':
        return Response.json({ authorizations: [] });
      case '/connections/api/connections/provision':
        return Response.json({ connection: { id: 'two', friendlyName: 'New connection' }, qr, expiresIn: 17 });
      default:
        throw new Error('Unexpected request: ' + input);
    }
  });
  const dom = openWorkspace(fetcher);
  try {
    const { document } = dom.window;
    const context = () => document.querySelector('#context-label')?.textContent;
    await vi.waitFor(() => expect(context()).toBe('Fixture'));
    document.querySelector<HTMLButtonElement>('#context-add')!.click();
    document.querySelector<HTMLButtonElement>('#confirm-provision')!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#qr-image')?.src).toBe(qr));
    expect(context()).toBe('Fixture');
    expect(fetcher).toHaveBeenCalledWith('/connections/api/connections/provision', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'X-WaPilot-CSRF': 'fixture-csrf' }),
    }));
  } finally { dom.window.close(); }
});

it('keeps an offline connection in the dashboard and confirms removal before sending it', async () => {
  const secondary = { id: 'two', friendlyName: 'Secondary', state: 'offline', isDefault: false };
  let deleteFails = true;
  let removed = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    switch (String(input)) {
      case '/connections/data':
      case '/connections/data?refresh=1':
        return Response.json({ connections: removed ? [connected] : [connected, secondary] });
      case '/connections/authorizations':
        return Response.json({ authorizations: [] });
      case '/connections/api/connections/two':
        if (init?.method !== 'DELETE') throw new Error('Expected DELETE');
        if (deleteFails) return Response.json({ error: 'Tente novamente.' }, { status: 502 });
        removed = true;
        return Response.json({ removed: true, instanceDeleted: true });
      default:
        throw new Error('Unexpected request: ' + input);
    }
  });
  const dom = openWorkspace(fetcher);
  try {
    const { document } = dom.window;
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    dom.window.confirm = confirm;
    const removeButton = () => document.querySelector<HTMLButtonElement>('[data-remove]');
    await vi.waitFor(() => expect(document.querySelector('#connection-title')?.textContent).toContain('Fixture'));
    expect(removeButton()).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-select="two"]')!.click();
    expect(document.querySelector<HTMLElement>('#dashboard-view')!.hidden).toBe(false);
    expect(document.querySelector('[data-open="two"]')?.textContent).toContain('Reconectar');
    removeButton()!.click();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Secondary'));
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    removeButton()!.click();
    await vi.waitFor(() => expect(document.querySelector('#toast')?.textContent).toContain('Não foi possível remover o número'));
    expect(document.querySelector('[data-select="two"]')).not.toBeNull();

    deleteFails = false;
    removeButton()!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-select="two"]')).toBeNull());
    expect(document.querySelector('#connection-title')?.textContent).toContain('Fixture');
  } finally { dom.window.close(); }
});

it('loads the next authorization page and confirms revocation against a fresh list', async () => {
  const grant = { id: 'grant', clientName: 'Inspector', expiresAt: 1893456000 };
  let revocations = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    switch (String(input)) {
      case '/connections/data':
        return Response.json({ connections: [connected] });
      case '/connections/authorizations':
        return Response.json({
          authorizations: revocations < 2 ? [grant] : [],
          nextCursor: revocations === 1 ? undefined : 'page/2',
        });
      case '/connections/authorizations?cursor=page%2F2':
        return Response.json({ authorizations: [{ id: 'another', clientName: 'Outro cliente' }] });
      case '/connections/authorizations/grant':
        if (init?.method !== 'DELETE') throw new Error('Expected DELETE');
        revocations++;
        return Response.json({ ok: true });
      default:
        throw new Error('Unexpected request: ' + input);
    }
  });
  const dom = openWorkspace(fetcher);
  try {
    const { document } = dom.window;
    const list = document.querySelector('#authorization-list')!;
    const revoke = () => list.querySelector<HTMLButtonElement>('[data-revoke="grant"]');
    await vi.waitFor(() => expect(list.textContent).toContain('Inspector'));
    expect(list.textContent).toContain(new Date('2030-01-01T00:00:00Z').toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }));

    const more = list.querySelector<HTMLButtonElement>('[data-auth-more]')!;
    more.click();
    more.click();
    expect(fetcher.mock.calls.filter(([path]) => path === '/connections/authorizations?cursor=page%2F2')).toHaveLength(1);
    await vi.waitFor(() => expect(list.textContent).toContain('Outro cliente'));
    expect(list.textContent).toContain('Inspector');
    expect(list.querySelector('[data-auth-more]')).toBeNull();

    revoke()!.click();
    await vi.waitFor(() => expect(document.querySelector('#toast')?.textContent).toContain('ainda aparece como ativa'));
    revoke()!.click();
    await vi.waitFor(() => expect(document.querySelector('#toast')?.textContent).toBe('Autorização desconectada.'));
    expect(list.textContent).toContain('Nenhuma autorização ativa');
    expect(revoke()).toBeNull();
    expect(list.querySelector('button')?.textContent).toBe('Carregar mais');
  } finally { dom.window.close(); }
});

it('shows subscription details and delivery results for the selected connection', async () => {
  const next = { ...connected, id: 'two', isDefault: false, friendlyName: 'Second fixture' };
  const item = {
    id: 'sub_' + 'a'.repeat(64),
    appName: 'Fixture <app>',
    callbackUrl: 'https://receiver.example.test/full/path?one=1&two=2',
    eventName: 'message.received',
    conversationId: null,
    state: 'active',
    authorization: 'valid',
    authorizationId: 'grant-reference',
    activatedAt: '2026-11-23T13:00:00Z',
    expiresAt: '2026-11-24T13:00:00Z',
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    switch (String(input)) {
      case '/connections/data': return Response.json({ connections: [connected, next] });
      case '/connections/authorizations': return Response.json({ authorizations: [] });
      case '/connections/api/connections/one/subscriptions': return Response.json({ subscriptions: [item] });
      case '/connections/api/connections/two/subscriptions': return Response.json({ subscriptions: [] });
      case '/connections/api/connections/one/subscriptions/' + item.id:
        return Response.json({ subscription: item, deliveries: [{
          state: 'failed', result: 'http_410', attempts: 1, messageId: 'message-fixture', receivedAt: item.activatedAt,
        }] });
      default: throw new Error('Unexpected request: ' + input);
    }
  });
  const dom = openWorkspace(fetcher);
  try {
    const { document } = dom.window;
    const section = document.querySelector('#subscriptions')!;
    await vi.waitFor(() => expect(section.querySelector('h4')?.textContent).toBe(item.appName));
    expect(section.querySelector('.subscription-url')?.textContent).toBe(item.callbackUrl);
    expect(section.querySelector('.subscription-url a')).toBeNull();
    expect(dom.window.getComputedStyle(section.querySelector('[data-load-subscriptions]')!).display).toBe('none');
    section.querySelector<HTMLElement>('.subscription-details summary')!.click();
    await vi.waitFor(() => expect(section.querySelector('.subscription-deliveries')?.textContent).toContain('Resposta HTTP 410'));
    expect(section.querySelector('.subscription-deliveries')?.textContent).toContain('message-fixture');
    expect(section.querySelector('.subscription-reference')?.textContent).toContain(item.authorizationId);
    expect(dom.window.getComputedStyle(section.querySelector('[data-load-deliveries]')!).display).toBe('none');
    document.querySelector<HTMLButtonElement>('[data-select="two"]')!.click();
    await vi.waitFor(() => expect(section.textContent).toContain('Nenhuma assinatura ativa nesta conexão.'));
    expect(section.textContent).not.toContain(item.callbackUrl);
  } finally { dom.window.close(); }
});
