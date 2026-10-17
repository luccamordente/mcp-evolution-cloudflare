import { describe, expect, it } from 'vitest';
import { avatarLookupJidFromPhone, extractAvatarUrl, extractDisplayName, extractPhone } from '../src/lib/connection-status';

describe('Evolution profile response helpers', () => {
  it('extracts the account display name from nested status data', () => {
    const payload = {
      jsonapi: { version: '1.1' },
      data: {
        type: 'connection',
        id: 'instance-1',
        attributes: {
          connected: true,
          loggedIn: true,
          name: 'Minha Conta',
        },
      },
    };

    expect(extractDisplayName(payload)).toBe('Minha Conta');
  });

  it('extracts the account JID from Evolution Go instance metadata', () => {
    const payload = {
      jsonapi: { version: '1.1' },
      data: {
        type: 'connection',
        id: 'instance-1',
        attributes: {
          connected: true,
          loggedIn: true,
          name: 'Minha Conta',
        },
        meta: {
          jid: '5511999999999:21@s.whatsapp.net',
        },
      },
    };

    expect(extractPhone(payload)).toBe('5511999999999');
  });

  it('normalizes a device JID to the canonical account JID for the avatar request', () => {
    expect(avatarLookupJidFromPhone('553187959283:21')).toBe('553187959283@s.whatsapp.net');
    expect(avatarLookupJidFromPhone('5511999999999@s.whatsapp.net')).toBe('5511999999999@s.whatsapp.net');
    expect(avatarLookupJidFromPhone('+5511999999999:21')).toBe('5511999999999@s.whatsapp.net');
  });

  it('extracts the avatar URL from the Evolution avatar envelope', () => {
    expect(extractAvatarUrl({
      jsonapi: { version: '1.1' },
      meta: { result: { URL: 'https://pps.whatsapp.net/avatar' } },
    })).toBe('https://pps.whatsapp.net/avatar');
  });

  it('ignores blank profile values', () => {
    expect(extractDisplayName({ data: { name: '   ' } })).toBeUndefined();
    expect(extractAvatarUrl({ data: { URL: '' } })).toBeUndefined();
  });
});
