export type ConnectionViewState = 'connected' | 'provisioning' | 'qr' | 'expired' | 'offline' | 'error';

/** Map an Evolution Go JSON:API connection resource to the UI state vocabulary. */
export function evolutionState(payload: unknown): ConnectionViewState {
  const attributes = connectionAttributes(payload);
  if (!attributes) return 'error';
  const connected = attributes.connected;
  const loggedIn = attributes.loggedIn;
  if (connected === true && loggedIn === true) return 'connected';
  if (loggedIn === false) return 'qr';
  if (connected === false && loggedIn === true) return 'offline';
  if (connected === true) return 'connected';
  return 'error';
}

function connectionResourceParts(payload: unknown): { attributes: Record<string, unknown>; meta?: Record<string, unknown> } | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const document = payload as Record<string, unknown>;
  const jsonapi = document.jsonapi;
  if (!jsonapi || typeof jsonapi !== 'object' || Array.isArray(jsonapi) || (jsonapi as Record<string, unknown>).version !== '1.1') return undefined;
  const resource = document.data;
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return undefined;
  const resourceRecord = resource as Record<string, unknown>;
  if (resourceRecord.type !== 'connection') return undefined;
  const attributes = resourceRecord.attributes;
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return undefined;
  const meta = resourceRecord.meta;
  return {
    attributes: attributes as Record<string, unknown>,
    meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : undefined,
  };
}

function connectionAttributes(payload: unknown): Record<string, unknown> | undefined {
  return connectionResourceParts(payload)?.attributes;
}

export function extractPhone(payload: unknown): string | undefined {
  const resource = connectionResourceParts(payload);
  if (!resource) return undefined;
  for (const wanted of ['phone', 'phoneNumber', 'number', 'ownerJid', 'jid', 'myJid']) {
    const value = resource.attributes[wanted] ?? resource.meta?.[wanted];
    if (typeof value === 'string' && value.replace(/\D/g, '').length >= 8) return value.replace(/@.*$/, '');
  }
  return undefined;
}

/** Build the full user JID accepted by Evolution Go's profile endpoint. */
export function avatarJidFromPhone(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;
  const [rawUser, rawServer] = candidate.split('@', 2);
  const user = rawUser.replace(/^\+/, '');
  if (!/^\d+(?::\d+)?$/.test(user) || user.replace(/\D/g, '').length < 8) return undefined;
  const server = rawServer?.trim() || 's.whatsapp.net';
  return `${user}@${server}`;
}

function extractStringByKeys(payload: unknown, wantedKeys: string[]): string | undefined {
  const wanted = new Set(wantedKeys.map((key) => key.toLowerCase()));
  const visit = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return undefined;
    }
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (wanted.has(key.toLowerCase()) && typeof child === 'string' && child.trim()) return child.trim();
    }
    for (const child of Object.values(record)) {
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  return visit(payload);
}

export function extractDisplayName(payload: unknown): string | undefined {
  return extractStringByKeys(payload, ['displayName', 'profileName', 'pushName', 'name', 'fullName']);
}

export function extractAvatarUrl(payload: unknown): string | undefined {
  const value = extractStringByKeys(payload, ['avatarUrl', 'pictureUrl', 'profilePictureUrl', 'profilePictureURL', 'url']);
  return value && /^https?:\/\//i.test(value) ? value : undefined;
}
