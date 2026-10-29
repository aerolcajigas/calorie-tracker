// Calls the live Calories API directly (bypasses nginx). Read-only use: node Calories/n8n/call.mjs state
// node Calories/n8n/call.mjs scan --image=<path.jpg> [--note="..."]   one real Haiku call (costs a fraction of a cent)
// Writes (add/update/remove/settings) also work, but this is my live log: only test writes on a fresh sheet.
import { readFileSync } from 'node:fs';
import { N8N, secrets } from '../lib.mjs';

const [action = 'state', json] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
let p = json ? JSON.parse(json) : {};
if (action === 'scan') p = { ...p, image: readFileSync(flag('image')).toString('base64'), mediaType: 'image/jpeg', note: flag('note') };
const t0 = Date.now();
const r = await fetch(`${N8N}/webhook/calories-api`, { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Cal-Key': secrets().api_secret }, body: JSON.stringify({ action, p }) });
const j = await r.json().catch(async () => ({ raw: await r.text() }));
console.log(r.status, `${Date.now() - t0} ms`);
console.log(JSON.stringify(j, null, 2).slice(0, 4000));
