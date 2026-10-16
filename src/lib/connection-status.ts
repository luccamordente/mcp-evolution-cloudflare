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

function connectionAttributes(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const document = payload as Record<string, unknown>;
  const jsonapi = document.jsonapi;
  if (!jsonapi || typeof jsonapi !== 'object' || Array.isArray(jsonapi) || (jsonapi as Record<string, unknown>).version !== '1.1') return undefined;
  const resource = document.data;
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return undefined;
  const resourceRecord = resource as Record<string, unknown>;
  if (resourceRecord.type !== 'connection') return undefined;
  const attributes = resourceRecord.attributes;
  return attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes as Record<string, unknown> : undefined;
}

export function extractPhone(payload: unknown): string | undefined {
  const attributes = connectionAttributes(payload);
  if (!attributes) return undefined;
  for (const wanted of ['phone', 'phoneNumber', 'number', 'ownerJid', 'jid', 'myJid']) {
    const value = attributes[wanted];
    if (typeof value === 'string' && value.replace(/\D/g, '').length >= 8) return value.replace(/@.*$/, '');
  }
  return undefined;
}
