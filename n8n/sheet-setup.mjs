// Creates the Google Sheet "Calories" (once) and writes the tab headers + default settings.
//   node Calories/n8n/sheet-setup.mjs     creates it if ~/.calories.json has no sheet_id, then (re)writes headers only
// Tabs: Entries (one row per food logged; removed rows are cleared, never deleted) and Settings (Key, Value).
import { randomUUID } from 'node:crypto';
import { runTemp, secrets, saveSecrets, SHEETS_CRED } from '../lib.mjs';

const S = secrets();
const path = 'cal-setup-' + randomUUID().slice(0, 10);
const http = (name, method, url, body, x) => ({ id: randomUUID(), name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [x, 0],
  credentials: SHEETS_CRED, parameters: { method, url, authentication: 'predefinedCredentialType', nodeCredentialType: 'googleSheetsOAuth2Api',
    sendBody: true, specifyBody: 'json', jsonBody: JSON.stringify(body), options: {} } });

const HEADERS = [
  { range: 'Entries!A1:H1', values: [['Id', 'Time', 'Food', 'Kcal', 'Emoji', 'Portion', 'Items', 'Source']] },
  { range: 'Settings!A1:B1', values: [['Key', 'Value']] },
  // Saved foods (2026-10-14): always in Recent, never counted until eaten.
  { range: 'Foods!A1:G1', values: [['Id', 'Added', 'Food', 'Kcal', 'Emoji', 'Portion', 'Items']] },
];
const nodes = [{ id: randomUUID(), name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: randomUUID(),
  parameters: { httpMethod: 'POST', path, responseMode: 'lastNode', options: {} } }];

let sheetId = S.sheet_id;
if (!sheetId) {
  nodes.push(http('Create', 'POST', 'https://sheets.googleapis.com/v4/spreadsheets', {
    properties: { title: 'Calories', timeZone: 'Asia/Manila' },
    sheets: [{ properties: { title: 'Entries', gridProperties: { frozenRowCount: 1 } } }, { properties: { title: 'Settings' } }, { properties: { title: 'Foods' } }],
  }, 240));
  // Defaults only on creation: goal 2000 kcal, "my day" starts 10:00 (anything before 10 AM counts for the day before).
  HEADERS.push({ range: 'Settings!A2:B3', values: [['goal', '2000'], ['dayStart', '10']] });
} else {
  // Existing sheet: add tabs that came later. Fails harmlessly (continues) when the tab is already there.
  const add = http('Add Foods', 'POST', `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { requests: [{ addSheet: { properties: { title: 'Foods' } } }] }, 240);
  add.onError = 'continueRegularOutput';
  nodes.push(add);
}
const headers = http('Headers', 'POST', 'https://sheets.googleapis.com/v4/spreadsheets/__ID__/values:batchUpdate', { valueInputOption: 'RAW', data: HEADERS }, 480);
headers.parameters.url = sheetId ? headers.parameters.url.replace('__ID__', sheetId)
  : "={{ 'https://sheets.googleapis.com/v4/spreadsheets/' + $('Create').first().json.spreadsheetId + '/values:batchUpdate' }}";
nodes.push(headers);
nodes.push({ id: randomUUID(), name: 'Done', type: 'n8n-nodes-base.code', typeVersion: 2, position: [720, 0], parameters: { jsCode:
  `return [{ json: { ok: true, spreadsheetId: ${sheetId ? JSON.stringify(sheetId) : "$('Create').first().json.spreadsheetId"}, updated: $input.first().json.totalUpdatedCells } }];` } });

const names = nodes.map((n) => n.name);
const connections = Object.fromEntries(names.slice(0, -1).map((n, i) => [n, { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] }]));
const out = await runTemp({ name: 'Calories / TEMP sheet setup (delete me)', nodes, connections, settings: { executionOrder: 'v1' } }, path);
console.log(JSON.stringify(out, null, 2));
if (out.ok && out.spreadsheetId && !sheetId) { saveSecrets({ sheet_id: out.spreadsheetId }); console.log('saved sheet_id to ~/.calories.json'); }
