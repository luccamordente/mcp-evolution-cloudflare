import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { connectionsPage } from '../src/ui/connections';

describe('connections workspace page', () => {
  it('renders the authenticated dashboard and onboarding controls', () => {
    const html = connectionsPage({ id: 'user-1', email: 'luccamordente@gmail.com', claims: {} });

    expect(html).toContain('WaPilot · Conexões');
    expect(html).toContain('dashboard-view');
    expect(html).toContain('onboarding-view');
    expect(html).toContain('displayName');
    expect(html).toContain('avatarUrl');
    expect(html).toContain('avatarMarkup');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('/api/connections/provision');
    expect(html).toContain("'/api/connections/'");
    expect(html).toContain("'/qr'");
    expect(html).toContain('luccamordente@gmail.com');
    expect(html).toContain('WaPilot — verde-carvao, inline');
    expect(html).toContain("window.location.hash === '#onboarding'");
    expect(html).toContain("else if (window.location.hash === '#onboarding') showOnboarding(current)");
    expect(html).toContain("if (connection.qr) setQrImage(connection.qr, connection.qrExpiresIn); startPolling();");
    expect(html).not.toContain("if (connection.qr) setQrImage(connection.qr, connection.qrExpiresIn); else renewQr(); startPolling();");
    expect(html).toContain('Autorizações');
    expect(html).toContain('authorization-list');
    expect(html).toContain("'/connections/authorizations'");
    expect(html).not.toContain("api('/api/authorizations");
    expect(html).toContain('Desconectar');
    expect(html).toContain('Nenhuma autorização ativa');
    expect(html).toContain('Não foi possível carregar as autorizações');
    expect(html).toContain('clientName');
    expect(html).toContain('expiresAt');
    expect(html).toContain('Number(value) * 1000');
    expect(html).toContain("const refreshed = await loadAuthorizations()");
    expect(html).toContain("ainda aparece como ativa");
    expect(html).toContain("const more = state.authorizationCursor");
    expect(html).toContain("Nenhuma autorização ativa</strong><p>Autorize um cliente MCP para vê-lo nesta lista.</p></div>' + more");
    expect(html).not.toContain('id="dashboard-add"');
    expect(html).not.toContain('id="activity-nav"');
    expect(html).not.toContain('class="notice"');
    expect(html).not.toContain('Atualizar estado');
    expect(html).not.toContain('__USER_EMAIL__');
  });
});

describe('continuing an existing connection awaiting QR', () => {
  const qr = 'data:image/png;base64,c3ludGhldGljLXFy';

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
    const dom = new JSDOM(connectionsPage({ id: 'user-1', email: 'user@example.test', claims: {} }), {
      url: `https://example.test/connections#${hash}`,
      runScripts: 'dangerously',
      beforeParse(window) { window.fetch = fetcher as typeof window.fetch; },
    });
    return { dom, fetcher };
  }

  it.each(['dashboard', 'onboarding'])('does not start pairing on initial #%s loading', async (hash) => {
    const { dom, fetcher } = workspace(undefined, hash);
    try {
      await vi.waitFor(() => expect(dom.window.document.querySelector('#context-label')?.textContent).toBe('Fixture'));
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
        expect((dom.window.document.querySelector('#qr-placeholder') as HTMLElement).hidden).toBe(true);
        expect(dom.window.document.querySelector('#countdown')?.textContent).toBe('00:17');
        const mutations = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
        expect(mutations.map(([path]) => path)).toEqual(hasQr ? [] : ['/connections/api/connections/one/qr']);
      } finally { dom.window.close(); }
    });
  });
});

it('describes the dashboard according to whether a connection exists', async () => {
  for (const connections of [[], [{ id: 'one', friendlyName: 'Fixture', state: 'connected', isDefault: true }]]) {
    const { JSDOM } = await import('jsdom');
    const html = connectionsPage({ id: 'user-1', email: 'user@example.test', claims: {} });
    const dom = new JSDOM(html, {
      url: 'https://example.test/connections#dashboard',
      runScripts: 'dangerously',
      beforeParse(window) {
        window.fetch = async (input) => ({
          ok: true,
          json: async () => String(input).includes('/connections/data') ? { connections } : { authorizations: [] },
        }) as Response;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    (dom.window.document.querySelector('#back-dashboard') as HTMLElement).click();
    const title = dom.window.document.querySelector('#dashboard-title')?.textContent;
    if (connections.length) expect(title).toBe('Seu WhatsApp está pronto para trabalhar.');
    else expect(title).not.toBe('Seu WhatsApp está pronto para trabalhar.');
    dom.window.close();
  }
});
