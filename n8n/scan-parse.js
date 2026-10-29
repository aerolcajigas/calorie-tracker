// Scan Parse: Haiku's reply -> { title, emoji, items, kcal, confidence, note, costUsd }. Nothing is saved here; the app
// shows the estimate for review and only "Add" writes (action "add").
const res = $input.first().json;
if (res.error || !Array.isArray(res.content)) {
  const msg = JSON.stringify(res.error || res).slice(0, 300);
  const error = /credit balance/i.test(msg) ? 'AI credits ran out (Anthropic account). Top up, then try again. You can still type it in.'
    : /overloaded|rate/i.test(msg) ? 'The AI is busy. Try again in a minute.' : 'The AI could not read it. Try again in a minute.';
  return [{ json: { r: { ok: false, error, detail: msg } } }];
}
if (res.stop_reason === 'refusal') return [{ json: { r: { ok: false, error: 'The AI declined this photo.' } } }];
if (res.stop_reason === 'max_tokens') return [{ json: { r: { ok: false, error: 'The AI ran out of room. Try again.' } } }];
if (res.stop_reason === 'pause_turn') return [{ json: { r: { ok: false, error: 'The brand lookup took too long. Try again, or add a note.' } } }];
// With web search the reply can hold text before/between searches; the answer is the text after the last search result.
const lastTool = res.content.map((b) => b.type).lastIndexOf('web_search_tool_result');
const text = res.content.slice(lastTool + 1).filter((b) => b.type === 'text').map((b) => b.text).join('');
let out;
try { out = JSON.parse(text); } catch { return [{ json: { r: { ok: false, error: 'The AI returned something unreadable. Try again.' } } }]; }
const items = (out.items || []).map((i) => ({ name: String(i.name || '').trim().slice(0, 60), portion: String(i.portion || '').trim().slice(0, 40),
  grams: Math.round(Number(i.grams)) || 0, kcal: Math.max(0, Math.round(Number(i.kcal)) || 0) })).filter((i) => i.name);
const u = res.usage || {};
const searches = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0; // $10 per 1,000
const costUsd = Math.round((((u.input_tokens || 0) * 0.10 + (u.output_tokens || 0) * 0.50) / 1e6 + searches * 0.01) * 1e6) / 1e6;
return [{ json: { r: { ok: true, title: String(out.title || '').trim().slice(0, 80), emoji: String(out.emoji || '').slice(0, 8), items,
  kcal: items.reduce((a, i) => a + i.kcal, 0), confidence: out.confidence || 'medium', note: String(out.note || '').replace(/—/g, ',').slice(0, 300), searches, costUsd } } }];
