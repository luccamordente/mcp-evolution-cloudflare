import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { connectionsPage } from '../src/ui/connections';

const connected = { id: 'one', friendlyName: 'Fixture', state: 'connected', isDefault: true };
const qr = 'data:image/png;base64,c3ludGhldGljLXFy';

function openWorkspace(fetcher: typeof fetch, hash = 'dashboard', webhookDestinations = false) {
  return new JSDOM(connectionsPage({ id: 'user-1', email: 'user@example.test', claims: {} }, '', webhookDestinations), {
    url: 'https://example.test/connections#' + hash,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = fetcher as typeof window.fetch;
      window.document.cookie = '__Host-wapilot_csrf=fixture-csrf; Secure; Path=/';
    },
  });
}

it('configures a webhook destination for the selected connection and displays a redacted summary', async () => {
  const url = 'https://api2.cursor.sh/automations/webhook/fixture';
  const key = 'synthetic-sender-key';
  const path = '/connections/api/connections/one/webhook-destinations';
  const destination = { id: 'opaque-destination-id', label: 'Fixture webhook', hostname: 'api2.cursor.sh', grantId: 'grant', conversationIds: ['120363000000001@g.us'], state: 'active' };
  let saved = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/connections/data') return Response.json({ connections: [connected] });
    if (String(input) === '/connections/authorizations') return Response.json({ authorizations: [{ id: 'grant', clientName: 'Fixture app', scopes: ['mcp:read'] }] });
    if (String(input) === path && init?.method === 'POST') { saved = true; return Response.json({ destination }, { status: 201 }); }
    if (String(input) === path) return Response.json({ destinations: saved ? [destination] : [] });
    return Response.json({ subscriptions: [] });
  });
  const dom = openWorkspace(fetcher, 'dashboard', true);
  try {
    const { document, Event } = dom.window;
    const section = document.querySelector<HTMLElement>('#webhook-destinations')!;
    await vi.waitFor(() => expect(section.hidden).toBe(false));
    const form = document.querySelector<HTMLFormElement>('#webhook-destination-form')!;
    await vi.waitFor(() => expect(form.querySelector('option[value=grant]')).not.toBeNull());
    form.querySelector<HTMLInputElement>('[name=label]')!.value = destination.label;
    form.querySelector('select')!.value = destination.grantId;
    form.querySelector<HTMLInputElement>('[name=url]')!.value = url;
    const keyField = form.querySelector<HTMLInputElement>('[data-webhook-key]')!;
    keyField.value = key;
    form.querySelector<HTMLTextAreaElement>('[name=conversationIds]')!.value = destination.conversationIds.join('\n');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(keyField.value).toBe('');
    await vi.waitFor(() => expect(section.textContent).toContain(destination.id));
    expect(section.textContent).toContain(destination.hostname);
    expect(section.innerHTML).not.toContain(url);
    expect(section.innerHTML).not.toContain(key);
    const request = fetcher.mock.calls.find(([input, init]) => input === path && init?.method === 'POST')?.[1];
    expect(request?.headers).toMatchObject({ 'X-WaPilot-CSRF': 'fixture-csrf' });
    expect(JSON.parse(String(request?.body))).toEqual({ url, key, label: destination.label, grantId: destination.grantId, conversationIds: destination.conversationIds });
  } finally { dom.window.close(); }
});

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
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 1);
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
    expiresAt: expiresAt.toISOString(),
  };
  const filtered = {
    ...item,
    id: 'sub_' + 'b'.repeat(64),
    appName: 'Fixture alerts',
    conversationId: '120000000000000001@g.us',
    authorization: 'unavailable',
  };
  const subscriptionPath = '/connections/api/connections/one/subscriptions';
  let stopped = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    switch (String(input)) {
      case '/connections/data': return Response.json({ connections: [connected, next] });
      case '/connections/authorizations': return Response.json({ authorizations: [] });
      case subscriptionPath: return Response.json({ subscriptions: stopped ? [filtered] : [item, filtered] });
      case subscriptionPath + '?recent=1':
        return Response.json({ subscriptions: [{ ...item, state: 'cancelled', endedAt: new Date().toISOString() }] });
      case '/connections/api/connections/two/subscriptions': return Response.json({ subscriptions: [] });
      case subscriptionPath + '/' + item.id:
        if (init?.method === 'DELETE') {
          stopped = true;
          return Response.json({ ok: true });
        }
        return Response.json({ subscription: item, deliveries: [{
          state: 'failed', result: 'http_410', attempts: 1, messageId: 'message-fixture', receivedAt: item.activatedAt,
        }] });
      case subscriptionPath + '/' + filtered.id:
        return Response.json({ subscription: filtered, deliveries: [] });
      default: throw new Error('Unexpected request: ' + input);
    }
  });
  const dom = openWorkspace(fetcher);
  try {
    const { document } = dom.window;
    const section = document.querySelector('#subscriptions')!;
    await vi.waitFor(() => expect(section.querySelector('.subscription-name')?.textContent).toBe(item.appName));
    const [row, filteredRow] = section.querySelectorAll<HTMLDetailsElement>('#subscription-current details');
    const summary = row.querySelector('summary')!;
    expect(row.open).toBe(false);
    expect(summary.querySelector('.subscription-meta')?.textContent).toBe('Todas as conversas');
    expect(summary.querySelector('.subscription-status')?.textContent).toBe('Ativa');
    expect(summary.querySelector('.subscription-timing strong')?.textContent).toBe('Expira amanhã');
    expect(summary.querySelector('time')?.dateTime).toBe(item.expiresAt);
    expect(summary.textContent).not.toContain(item.callbackUrl);
    expect(filteredRow.querySelector('summary')?.textContent).toContain('Uma conversa específica');
    expect(filteredRow.querySelector('.subscription-status.is-warning')?.textContent).toBe('Autorização não verificada');
    expect(fetcher.mock.calls.some(([path]) => path === subscriptionPath + '/' + item.id)).toBe(false);
    expect(dom.window.getComputedStyle(section.querySelector('[data-load-subscriptions]')!).display).toBe('none');
    summary.click();
    filteredRow.querySelector('summary')!.click();
    await vi.waitFor(() => expect(row.querySelector('.subscription-deliveries')?.textContent).toContain('Resposta HTTP 410'));
    await vi.waitFor(() => expect(filteredRow.textContent).toContain('Nenhuma entrega registrada nas últimas 24 horas.'));
    expect(row.open).toBe(true);
    expect(row.querySelector('.subscription-body h4')?.textContent).toBe('Entregas nas últimas 24 horas');
    expect(row.querySelector('.subscription-deliveries')?.textContent).toContain('message-fixture');
    expect(row.querySelector('.subscription-facts')?.textContent).toContain(item.authorizationId);
    expect(row.querySelector('.subscription-url')?.textContent).toBe(item.callbackUrl);
    expect(row.querySelector('.subscription-url a')).toBeNull();
    expect(filteredRow.querySelector('.subscription-facts')?.textContent).toContain(filtered.conversationId);
    expect(dom.window.getComputedStyle(row.querySelector('[data-load-deliveries]')!).display).toBe('none');

    const dialog = section.querySelector('dialog')!;
    dialog.showModal = vi.fn();
    row.querySelector<HTMLButtonElement>('[data-stop-subscription]')!.click();
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(dialog.querySelector('p')?.textContent).toContain(item.appName);
    dialog.returnValue = 'stop';
    dialog.dispatchEvent(new dom.window.Event('close'));
    const recent = section.querySelector<HTMLDetailsElement>('#subscription-recent')!;
    await vi.waitFor(() => expect(recent.querySelector('.subscription-status')?.textContent).toBe('Encerrada'));
    expect(recent.open).toBe(true);
    expect(recent.querySelector('[data-stop-subscription]')).toBeNull();

    document.querySelector<HTMLButtonElement>('[data-select="two"]')!.click();
    await vi.waitFor(() => expect(section.textContent).toContain('Nenhuma assinatura vigente nesta conexão.'));
    expect(section.textContent).not.toContain(item.callbackUrl);
  } finally { dom.window.close(); }
});
