// Build: turns the sheet into { entries, settings, foods } for the app and, for writes, describes ONE Sheets call in `op`
// (appendCells / update a row / clear a row / settings). The reply already includes the change, so the app needs no reload.
// Entries rows: A Id, B Time (ISO, +08:00), C Food, D Kcal, E Emoji, F Portion, G Items (JSON), H Source.
// Removed entries are cleared (row stays, empty), so row numbers never shift.
const { action, p } = $('Gate').first().json;
const vr = $input.first().json.valueRanges || [];
const rows = (vr[0] && vr[0].values) || [];
const setRows = (vr[1] && vr[1].values) || [];
const fail = (error) => [{ json: { r: { ok: false, error } } }];

const settings = { goal: 2000, dayStart: 10 };
for (const [k, v] of setRows.slice(1)) if (k in settings && v !== '' && !isNaN(Number(v))) settings[k] = Number(v);

const entries = [];
rows.forEach((r, i) => {
  if (i === 0 || !r || !r[0]) return; // header / cleared row
  let items = [];
  try { items = r[6] ? JSON.parse(r[6]) : []; } catch {}
  entries.push({ row: i + 1, id: r[0], time: r[1] || '', food: r[2] || '', kcal: Math.round(Number(String(r[3] || '0').replace(/,/g, ''))) || 0,
    emoji: r[4] || '', portion: r[5] || '', items, source: r[7] || '' });
});

// Saved foods (2026-10-14): staples that always show in Recent without being eaten. Not counted toward any day.
// Foods rows: A Id, B Added (ISO), C Food, D Kcal, E Emoji, F Portion, G Items (JSON). Removed = cleared row.
const foods = [];
((vr[2] && vr[2].values) || []).forEach((r, i) => {
  if (i === 0 || !r || !r[0]) return;
  let items = [];
  try { items = r[6] ? JSON.parse(r[6]) : []; } catch {}
  foods.push({ row: i + 1, id: r[0], time: r[1] || '', food: r[2] || '', kcal: Math.round(Number(String(r[3] || '0').replace(/,/g, ''))) || 0,
    emoji: r[4] || '', portion: r[5] || '', items });
});

// ISO time in Manila (+08:00), whatever offset the phone sent.
const manila = (t) => {
  const d = new Date(t);
  if (isNaN(d)) return null;
  const m = new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 19);
  return m + '+08:00';
};
const clean = (e) => {
  const id = String(e.id || '');
  const time = manila(e.time);
  const kcal = Math.round(Number(e.kcal));
  const food = String(e.food || '').trim().slice(0, 80);
  if (!/^[a-z0-9-]{6,40}$/.test(id) || !time || !food || !(kcal >= 0 && kcal <= 10000)) return null;
  const items = (Array.isArray(e.items) ? e.items : []).slice(0, 12).map((x) => ({
    name: String(x.name || '').slice(0, 60), portion: String(x.portion || '').slice(0, 40), kcal: Math.round(Number(x.kcal)) || 0 }));
  return { id, time, food, kcal, emoji: String(e.emoji || '').slice(0, 8), portion: String(e.portion || '').slice(0, 60), items,
    source: ['photo', 'recent', 'typed'].includes(e.source) ? e.source : 'typed' };
};
const toRow = (e) => [e.id, e.time, e.food, e.kcal, e.emoji, e.portion, e.items.length ? JSON.stringify(e.items) : '', e.source];
// New rows go in with appendCells (always column A, after the last row with data), NOT values:append: once rows were
// cleared, values:append guessed the "table" wrong and wrote new entries into columns H-O, where the app can't see them
// (2026-10-15). Tab ids: Entries 1098244156, Foods 198412863.
const appendRows = (sheetId, rows) => ({ method: 'POST', url: ':batchUpdate', body: { requests: [{ appendCells: { sheetId, fields: 'userEnteredValue',
  rows: rows.map((r) => ({ values: r.map((v) => ({ userEnteredValue: typeof v === 'number' ? { numberValue: v } : { stringValue: String(v) } })) })) } }] } });
const strip = (list) => list.map(({ row, ...e }) => e);
const reply = (op) => [{ json: { op, r: { ok: true, entries: strip(entries), settings, foods: strip(foods) } } }];

if (action === 'state') return reply(null);

if (action === 'add') {
  const list = (Array.isArray(p.entries) ? p.entries : []).slice(0, 20).map(clean);
  if (!list.length || list.some((e) => !e)) return fail('Could not save: the entry is missing a name, calories or time.');
  const have = new Set(entries.map((e) => e.id));
  const fresh = list.filter((e) => !have.has(e.id)); // a retried request must not log the same food twice
  if (!fresh.length) return reply(null);
  entries.push(...fresh);
  return reply(appendRows(1098244156, fresh.map(toRow)));
}

if (action === 'update') {
  const e = clean(p.entry || {});
  if (!e) return fail('Could not save: the entry is missing a name, calories or time.');
  const at = entries.findIndex((x) => x.id === e.id);
  if (at < 0) return fail('That entry is gone (removed on another screen?). Pull to refresh.');
  const row = entries[at].row;
  entries[at] = { ...e, row };
  return reply({ method: 'PUT', url: `values/${encodeURIComponent(`Entries!A${row}:H${row}`)}?valueInputOption=RAW`, body: { values: [toRow(e)] } });
}

if (action === 'remove') {
  const at = entries.findIndex((x) => x.id === String(p.id || ''));
  if (at < 0) return reply(null); // already gone
  const row = entries[at].row;
  entries.splice(at, 1);
  return reply({ method: 'POST', url: `values/${encodeURIComponent(`Entries!A${row}:H${row}`)}:clear`, body: {} });
}

if (action === 'settings') {
  const goal = Math.round(Number(p.goal)), dayStart = Math.round(Number(p.dayStart));
  if (!(goal >= 800 && goal <= 6000)) return fail('Daily goal should be between 800 and 6,000 kcal.');
  if (!(dayStart >= 0 && dayStart <= 14)) return fail('Day start should be between 12 AM and 2 PM.');
  settings.goal = goal; settings.dayStart = dayStart;
  return reply({ method: 'PUT', url: `values/${encodeURIComponent('Settings!A2:B3')}?valueInputOption=RAW`,
    body: { values: [['goal', String(goal)], ['dayStart', String(dayStart)]] } });
}

if (action === 'food') {
  if (p.remove) {
    const at = foods.findIndex((x) => x.id === String(p.remove));
    if (at < 0) return reply(null);
    const row = foods[at].row;
    foods.splice(at, 1);
    return reply({ method: 'POST', url: `values/${encodeURIComponent(`Foods!A${row}:G${row}`)}:clear`, body: {} });
  }
  const now = manila(new Date().toISOString());
  const list = (Array.isArray(p.add) ? p.add : []).slice(0, 20).map((f) => clean({ ...f, time: now }));
  if (!list.length || list.some((f) => !f)) return fail('Could not save: the food is missing a name or calories.');
  const have = new Set(foods.map((f) => f.id));
  const fresh = list.filter((f) => !have.has(f.id));
  if (!fresh.length) return reply(null);
  foods.push(...fresh.map(({ source, ...f }) => f));
  return reply(appendRows(198412863, fresh.map((f) => toRow(f).slice(0, 7))));
}

return fail('Unknown action');
