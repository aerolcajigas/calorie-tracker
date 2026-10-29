// Gate: checks the nginx key, handles the PIN login (5 wrong tries = 15 min lock), routes everything else.
// __API_SECRET__, __DASH_TOKEN__ and __PIN__ are filled in by build.mjs.
const KEY = '__API_SECRET__', TOKEN = '__DASH_TOKEN__', PIN = '__PIN__';
const req = $input.first().json;
const h = req.headers || {}, body = req.body || {};
const action = String(body.action || ''), p = body.p || {};
const out = (o) => [{ json: o }];

if (h['x-cal-key'] !== KEY) return out({ route: 'respond', status: 401, r: { ok: false, error: 'Not allowed' } });

const isLoginDoor = h['x-cal-login'] === '1';
if (isLoginDoor && action !== 'login') return out({ route: 'respond', status: 401, r: { ok: false, error: 'Not allowed' } });

if (action === 'login') {
  const sd = $getWorkflowStaticData('global');
  const now = Date.now();
  if ((sd.lockedUntil || 0) > now) {
    const min = Math.ceil((sd.lockedUntil - now) / 60000);
    return out({ route: 'respond', r: { ok: false, error: `Too many tries. Try again in ${min} min.` } });
  }
  if (String(p.pin || '') === PIN) { sd.fails = 0; return out({ route: 'respond', r: { ok: true, token: TOKEN } }); }
  sd.fails = (sd.fails || 0) + 1;
  if (sd.fails >= 5) { sd.fails = 0; sd.lockedUntil = now + 15 * 60000; return out({ route: 'respond', r: { ok: false, error: 'Too many tries. Try again in 15 min.' } }); }
  return out({ route: 'respond', r: { ok: false, error: 'Wrong PIN' } });
}

if (action === 'scan') return out({ route: 'scan', action, p });
if (['state', 'add', 'update', 'remove', 'settings', 'food'].includes(action)) return out({ route: 'data', action, p });
return out({ route: 'respond', status: 400, r: { ok: false, error: 'Unknown action' } });
