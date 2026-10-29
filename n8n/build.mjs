// Builds + deploys the n8n workflow "Calories / API" (webhook calories-api) that backs calories.example.com.
//   node Calories/n8n/build.mjs            write workflows/api.json only (secrets masked)
//   node Calories/n8n/build.mjs --deploy   create/update it on n8n and (re)activate
// Data: Google Sheet "Calories" (id in ~/.calories.json, made by sheet-setup.mjs). Photos go to Claude Haiku, never stored.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { api, secrets, saveSecrets, SHEETS_CRED } from '../lib.mjs';

const here = (f) => new URL(f, import.meta.url);
const S = secrets();
if (!S.sheet_id) throw new Error('No sheet_id in ~/.calories.json: run node Calories/n8n/sheet-setup.mjs first');
if (!S.webhook_id) S.webhook_id = saveSecrets({ webhook_id: randomUUID() }).webhook_id;
const SHEET = S.sheet_id;
const ANTHROPIC_CRED = { anthropicApi: { id: 'ANTHROPIC_CREDENTIAL_ID', name: 'Anthropic account' } };

let x = 0;
const node = (name, type, typeVersion, parameters, extra = {}) =>
  ({ id: randomUUID(), name, type, typeVersion, position: [(x++) * 240, 0], parameters, ...extra });
const code = (name, file, fill = (s) => s) => node(name, 'n8n-nodes-base.code', 2, { jsCode: fill(readFileSync(here(file), 'utf8')) });
const ifEq = (name, left, right) => node(name, 'n8n-nodes-base.if', 2.2, {
  conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: randomUUID(), leftValue: left, rightValue: right, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
  looseTypeValidation: true, options: {},
});

export function workflow(mask = false) {
  const fillGate = (s) => s.replaceAll("'__API_SECRET__'", JSON.stringify(mask ? '***' : S.api_secret))
    .replaceAll("'__DASH_TOKEN__'", JSON.stringify(mask ? '***' : S.dash_token)).replaceAll("'__PIN__'", JSON.stringify(mask ? '***' : S.pin));
  const nodes = [
    node('Webhook', 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: 'calories-api', responseMode: 'responseNode', options: {} },
      { webhookId: S.webhook_id }),
    code('Gate', 'gate.js', fillGate),
    ifEq('Need Data?', '={{ $json.route }}', 'data'),
    node('Read Sheet', 'n8n-nodes-base.httpRequest', 4.2, {
      method: 'GET', url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values:batchGet?ranges=Entries!A:H&ranges=Settings!A:B&ranges=Foods!A:G`, // every tab must exist (sheet-setup.mjs)
      authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api', options: {},
    }, { credentials: SHEETS_CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),
    code('Build', 'build.js'),
    ifEq('Write?', '={{ $json.op ? "yes" : "no" }}', 'yes'),
    node('Sheets Write', 'n8n-nodes-base.httpRequest', 4.2, {
      method: '={{ $json.op.method }}', url: `={{ 'https://sheets.googleapis.com/v4/spreadsheets/${SHEET}' + ($json.op.url.startsWith(':') ? '' : '/') + $json.op.url }}`,
      authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.op.body) }}', options: {},
    }, { credentials: SHEETS_CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),
    node('Written', 'n8n-nodes-base.code', 2, { jsCode: "return [{ json: { r: $('Build').first().json.r } }];" }),
    ifEq('Scan?', '={{ $json.route }}', 'scan'),
    code('Scan Request', 'scan.js'),
    ifEq('Call AI?', '={{ $json.skip ? "no" : "yes" }}', 'yes'),
    node('Claude Haiku', 'n8n-nodes-base.httpRequest', 4.2, {
      method: 'POST', url: 'https://api.anthropic.com/v1/messages',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'anthropicApi',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'anthropic-version', value: '2023-06-01' }] },
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}', options: { timeout: 90000 },
    }, { credentials: ANTHROPIC_CRED, onError: 'continueRegularOutput' }),
    code('Scan Parse', 'scan-parse.js'),
    node('Respond', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'json', responseBody: '={{ JSON.stringify({ r: $json.r }) }}',
      options: { responseCode: '={{ $json.status || 200 }}', responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } } }),
  ];
  const to = (n, i = 0) => ({ node: n, type: 'main', index: i });
  const connections = {
    Webhook: { main: [[to('Gate')]] },
    Gate: { main: [[to('Need Data?')]] },
    'Need Data?': { main: [[to('Read Sheet')], [to('Scan?')]] },
    'Read Sheet': { main: [[to('Build')]] },
    Build: { main: [[to('Write?')]] },
    'Write?': { main: [[to('Sheets Write')], [to('Respond')]] },
    'Sheets Write': { main: [[to('Written')]] },
    Written: { main: [[to('Respond')]] },
    'Scan?': { main: [[to('Scan Request')], [to('Respond')]] },
    'Scan Request': { main: [[to('Call AI?')]] },
    'Call AI?': { main: [[to('Claude Haiku')], [to('Respond')]] },
    'Claude Haiku': { main: [[to('Scan Parse')]] },
    'Scan Parse': { main: [[to('Respond')]] },
  };
  return { name: 'Calories / API', nodes, connections,
    settings: { executionOrder: 'v1', timezone: 'Asia/Manila', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all' } };
}

mkdirSync(here('./workflows/'), { recursive: true });
writeFileSync(here('./workflows/api.json'), JSON.stringify(workflow(true), null, 2));

if (process.argv.includes('--deploy')) {
  const wf = workflow(false);
  let id = S.workflow_id;
  if (id) await api('PUT', `/api/v1/workflows/${id}`, wf);
  else { id = (await api('POST', '/api/v1/workflows', wf)).id; saveSecrets({ workflow_id: id }); }
  // Toggle so the webhook is surely registered after an edit (stale-webhook gotcha).
  try { await api('POST', `/api/v1/workflows/${id}/deactivate`); } catch {}
  await api('POST', `/api/v1/workflows/${id}/activate`);
  console.log('deployed Calories / API', id);
} else console.log('wrote Calories/n8n/workflows/api.json (secrets masked)');
