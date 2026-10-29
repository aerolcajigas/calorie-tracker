// Calories (calories.example.com): shared helpers. n8n API key comes from env N8N_API_URL / N8N_API_KEY, secrets from ~/.calories.json
// (api_secret = nginx -> n8n header, dash_token = PIN cookie value, sheet_id, workflow_id). Never print or copy them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const env = process.env; // N8N_API_URL, N8N_API_KEY
export const N8N = env.N8N_API_URL.replace(/\/$/, '');
export const SHEETS_CRED = { googleSheetsOAuth2Api: { id: 'SHEETS_CREDENTIAL_ID', name: 'Google Sheets' } };
export const SSH_CRED = { sshPassword: { id: 'SSH_CREDENTIAL_ID', name: 'VPS SSH' } };

export async function api(method, path, body) {
  const r = await fetch(N8N + path, {
    method, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body || {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 500)}`);
  return t ? JSON.parse(t) : {};
}

// Create a temp webhook workflow, toggle-activate (stale webhook gotcha), call it, always delete it.
export async function runTemp(wf, path, payload = {}, timeoutMs = 300000, raw = false) {
  const created = await api('POST', '/api/v1/workflows', wf);
  try {
    await api('POST', `/api/v1/workflows/${created.id}/activate`);
    await api('POST', `/api/v1/workflows/${created.id}/deactivate`);
    await api('POST', `/api/v1/workflows/${created.id}/activate`);
    const r = await fetch(`${N8N}/webhook/${path}`, { method: 'POST',
      headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
      body: raw ? payload : JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { status: r.status, raw: t.slice(0, 2000) }; }
  } finally {
    try { await api('POST', `/api/v1/workflows/${created.id}/deactivate`); } catch {}
    try { await api('DELETE', `/api/v1/workflows/${created.id}`); } catch { console.error('WARN temp workflow not deleted', created.id); }
  }
}

export const SECRETS_PATH = `${homedir()}/.calories.json`;
export function secrets() {
  const s = existsSync(SECRETS_PATH) ? JSON.parse(readFileSync(SECRETS_PATH, 'utf8')) : {};
  let changed = false;
  for (const k of ['api_secret', 'dash_token']) if (!s[k]) { s[k] = randomBytes(24).toString('hex'); changed = true; }
  if (changed) writeFileSync(SECRETS_PATH, JSON.stringify(s, null, 2));
  return s;
}
export function saveSecrets(patch) {
  const s = { ...secrets(), ...patch };
  writeFileSync(SECRETS_PATH, JSON.stringify(s, null, 2));
  return s;
}
