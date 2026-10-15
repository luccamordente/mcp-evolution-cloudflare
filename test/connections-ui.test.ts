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
    expect(html).not.toContain('__USER_EMAIL__');
  });
});
