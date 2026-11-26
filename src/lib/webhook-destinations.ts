import { z } from 'zod';
import type { Env } from '../types';

export function canonicalWebhookConversation(value: string): string {
  const id = value.trim();
  return /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(id)?.[1] ?? id;
}

export function isNativeWebhookClient(env: Env, clientId: string): boolean {
  const configured = env.WEBHOOK_NATIVE_CLIENT_IDS;
  if (!configured) return false;
  try {
    return z.array(z.string()).parse(JSON.parse(configured)).includes(clientId);
  } catch {
    return true;
  }
}

export function routineUrl(input: string, hostname: string | undefined): URL | undefined {
  if (/[?#]/.test(input)) return;
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' && url.hostname === hostname && !url.port && !url.username && !url.password
      && /^\/automations\/webhook\/[A-Za-z0-9_-]{1,200}$/.test(url.pathname)) return url;
  } catch {
    return;
  }
}
