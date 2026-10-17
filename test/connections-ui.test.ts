import { describe, expect, it } from 'vitest';
import { connectionsPage } from '../src/ui/connections';

describe('connections workspace page', () => {
  it('renders the authenticated dashboard and onboarding controls', () => {
    const html = connectionsPage({ id: 'user-1', email: 'luccamordente@gmail.com', claims: {} });

    expect(html).toContain('WaPilot · Conexões');
    expect(html).toContain('dashboard-view');
    expect(html).toContain('onboarding-view');
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
