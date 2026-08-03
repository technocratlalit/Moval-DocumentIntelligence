import { _config } from '../../config/config.js';

export type WebhookTenant = 'in' | 'com';

const TENANTS: WebhookTenant[] = ['in', 'com'];

/** Parse X-Aimodule-Tenant header — only "in" or "com" (case-insensitive). */
export function parseTenantHeader(value: unknown): WebhookTenant | undefined {
  if (value == null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  return TENANTS.includes(normalized as WebhookTenant) ? (normalized as WebhookTenant) : undefined;
}

/** Resolve webhook target: tenant → WEBHOOK_URL_IN/COM, else WEBHOOK_URL fallback. */
export function resolveWebhookUrl(tenant?: WebhookTenant): string | null {
  if (tenant === 'in') return _config.WEBHOOK_URL_IN ?? null;
  if (tenant === 'com') return _config.WEBHOOK_URL_COM ?? null;
  return _config.WEBHOOK_URL ?? null;
}

// ponytail: no host allowlist yet — upgrade path: validate hostname against WEBHOOK_ALLOWED_HOSTS
if (process.env.NODE_ENV !== 'production') {
  console.assert(parseTenantHeader('IN') === 'in', 'parseTenantHeader case fold');
  console.assert(parseTenantHeader('xyz') === undefined, 'parseTenantHeader rejects unknown');
  console.assert(resolveWebhookUrl(undefined) === (_config.WEBHOOK_URL ?? null), 'resolveWebhookUrl fallback');
}
