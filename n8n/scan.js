// Scan Request: builds the Claude Haiku 5.5 call that turns a food photo into a calorie estimate.
// Cheapest Claude ($0.10 / $0.50 per 1M tokens); effort medium because portion sizing benefits from a little thought
// (still well under $0.001 a photo; ~1-2 cents when it searches a brand). Structured output so the reply is always valid JSON.
// The app shrinks the photo to <= 1280 px JPEG first, and sends my optional note + his recent food names.
const { p } = $('Gate').first().json;
const image = String(p.image || '').replace(/^data:[^,]+,/, '');
const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(p.mediaType) ? p.mediaType : 'image/jpeg';
const note = String(p.note || '').trim().slice(0, 300);
const known = (Array.isArray(p.known) ? p.known : []).map((k) => String(k).slice(0, 140)).slice(0, 40);
if (!image || image.length < 100) return [{ json: { skip: true, r: { ok: false, error: 'No photo received.' } } }];
if (image.length > 7e6) return [{ json: { skip: true, r: { ok: false, error: 'Photo too big. Try again.' } } }];

const system = [
  'You estimate calories from a photo of food for a personal calorie tracker. The person lives in the Philippines, so expect Filipino dishes, rice meals, fast food (Jollibee, McDonald\'s, Mang Inasal), street food, convenience-store snacks, drinks and home cooking, as well as anything else.',
  'List each distinct food or drink you can see as its own item: a short plain name, the portion in everyday terms (e.g. "1 cup rice", "2 pcs", "1 bowl", "16 oz"), your gram estimate, and its calories.',
  'Size portions from visual cues: plate and bowl size, utensils, hands, packaging. Count the oil, sauce, sugar and rice you can see; they are where most estimates go wrong. Assume a normal home or restaurant recipe when unsure.',
  'If a package or menu label with nutrition facts is visible, use it. If the photo is a nutrition label or receipt only, read it.',
  'Look for brand names, logos, packaging and menu items. If you can read a brand or a chain\'s menu item, put it in the item name. Unless you already know its calories for sure, use web search to find the official nutrition info (the brand\'s own site first, then reliable nutrition sites; search in English or in the language on the package) and use that number, scaled to the portion you see. If the first search doesn\'t turn up the brand\'s own figure, search once more a different way (the brand\'s site name, the country it\'s from, or the package\'s language) before falling back to generic data. Don\'t search for unbranded or home-cooked food.',
  'title: a short name for the whole meal as the person would say it (e.g. "Chicken adobo with rice"). If it matches one of the recent foods listed below, reuse that exact name so it groups with past entries.',
  'emoji: one emoji that best shows the meal.',
  'confidence: high when the food and portion are clear, medium for normal photos, low when the food is hidden, blurry or ambiguous.',
  'note: one short sentence on what drives the estimate or what would change it (e.g. "Assumed 1 cup of rice; say if it was 2."). If you searched, say where the number came from (e.g. "From the Daykey site: 240 kcal per donut.") or that you couldn\'t find it and estimated. Plain English, no em dashes.',
  'If there is no food or drink in the photo, return an empty items list and say so in note.',
  // Since 2026-10-15 each line carries the calories he saved for one full serving: his number wins over search or a
  // fresh estimate, so the same food never comes back at a different number.
  known.length ? `Recent foods he logged before, with the calories he saved for one full serving: ${known.join('; ')}\nIf the photo shows one of these foods, reuse its exact name and those calories (scaled to the portion you see) instead of searching or estimating again, and say so in note.` : '',
].filter(Boolean).join('\n');

const body = {
  model: 'claude-haiku-5-5', max_tokens: 6000, system,
  // Web search (2026-10-15, his ask): only used when a brand is visible. $0.01 a search; basic version because the
  // _20260209 one isn't on Haiku. Capped at 2 searches a photo.
  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2,
    user_location: { type: 'approximate', country: 'PH', timezone: 'Asia/Manila' } }],
  output_config: { effort: 'medium', format: { type: 'json_schema', schema: {
    type: 'object', additionalProperties: false, required: ['title', 'emoji', 'items', 'confidence', 'note'],
    properties: {
      title: { type: 'string' },
      emoji: { type: 'string' },
      items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'portion', 'grams', 'kcal'],
        properties: { name: { type: 'string' }, portion: { type: 'string' }, grams: { type: 'number' }, kcal: { type: 'number' } } } },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      note: { type: 'string' },
    },
  } } },
  messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
    { type: 'text', text: note ? `Estimate the calories. What I know about it: ${note}` : 'Estimate the calories.' },
  ] }],
};
return [{ json: { body } }];
