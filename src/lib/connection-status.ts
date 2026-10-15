export type ConnectionViewState = 'connected' | 'provisioning' | 'qr' | 'expired' | 'offline' | 'error';

/** Map Evolution Go's documented boolean status response and legacy textual
 * responses to the UI state vocabulary. */
export function evolutionState(payload: unknown): ConnectionViewState {
  const flags = evolutionConnectionFlags(payload);
  if (flags?.connected === true && flags.loggedIn === true) return 'connected';
  if (flags?.loggedIn === false) return 'qr';
  if (flags?.connected === false && flags.loggedIn === true) return 'offline';
  if (flags?.connected === true) return 'connected';

  const values: string[] = [];
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string' && /(state|status|connection|instance|qr|pair)/i.test(key)) values.push(value.toLowerCase());
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(payload);
  const joined = values.join(' ');
  if (!joined) return 'error';
  if (/(qr|qrcode|pairing|scan)/.test(joined)) return 'qr';
  if (/(disconnect|offline|closed|logout|close)/.test(joined)) return 'offline';
  if (/(error|fail|unavailable)/.test(joined)) return 'error';
  if (/(creat|provision|pending|process)/.test(joined)) return 'provisioning';
  return 'connected';
}

function evolutionConnectionFlags(payload: unknown): { connected?: boolean; loggedIn?: boolean } | undefined {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = evolutionConnectionFlags(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const connectedKey = Object.keys(record).find((key) => key.toLowerCase() === 'connected');
  const loggedInKey = Object.keys(record).find((key) => key.toLowerCase() === 'loggedin');
  const connected = connectedKey && typeof record[connectedKey] === 'boolean' ? record[connectedKey] as boolean : undefined;
  const loggedIn = loggedInKey && typeof record[loggedInKey] === 'boolean' ? record[loggedInKey] as boolean : undefined;
  if (connected !== undefined || loggedIn !== undefined) return { connected, loggedIn };
  for (const value of Object.values(record)) {
    const found = evolutionConnectionFlags(value);
    if (found) return found;
  }
  return undefined;
}

export function extractPhone(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const wanted of ['phone', 'phonenumber', 'number', 'ownerjid', 'jid', 'myjid']) {
    const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === wanted);
    const value = key ? record[key] : undefined;
    if (typeof value === 'string' && value.replace(/\D/g, '').length >= 8) return value.replace(/@.*$/, '');
  }
  for (const value of Object.values(record)) { const found = extractPhone(value); if (found) return found; }
  return undefined;
}
