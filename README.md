# Calorie Tracker

A phone-first calorie tracker. Snap a photo of a meal, Claude Haiku estimates the calories, and you confirm or edit
before anything is saved. No app store, no database server: one static page, one n8n workflow, one Google Sheet.

## How it works

```
web/index.html  ->  nginx (PIN cookie check, adds a secret header)  ->  n8n webhook  ->  Google Sheets + Claude Haiku
```

- **Photo to calories.** The phone shrinks the photo to 1280 px JPEG and sends it to the n8n workflow. Claude Haiku
  returns structured JSON: meal title, emoji, per-item breakdown (portion, grams, kcal), confidence and a note. It may
  run up to 2 web searches, only for branded food it can read on the package. Cost is about $0.0005 per photo.
- **The AI is a suggestion.** The estimate opens the normal "Add food" form. Every field stays editable, a field you
  already touched is never overwritten, and a "How much did you eat?" slider scales the total.
- **"My day" is configurable.** A day runs from a chosen hour (default 10 AM) to the same hour the next day, so a
  3 AM snack counts for the night before. It's computed on the phone, so changing it regroups history too.
- **Recent and saved foods.** One tap re-logs a recent meal, with Undo.
- **Trends.** 1 or 3 months of daily bars, a 7-day average line and the goal line, plus weekly and monthly tables.
- **Safe writes.** Rows are never deleted (cleared instead) so row numbers never shift. IDs come from the phone, so a
  retried add is skipped instead of duplicated.
- **Login.** A PIN screen with 5 tries, then a 15 minute lock. A correct PIN sets a long-lived cookie that nginx checks.

## Layout

| Path | What |
|---|---|
| `web/` | The app (`index.html`), PIN page, icons, PWA manifest. `preview.mjs` runs UI checks and screenshots against a mock API with fake data. |
| `n8n/gate.js` | Checks the nginx secret, handles PIN login and lockout, routes the action. |
| `n8n/build.js` | Turns the sheet into app state and builds the single Sheets API call for each write. |
| `n8n/scan.js`, `scan-parse.js` | Builds the Claude request for a photo and parses the reply (with cost). |
| `n8n/build.mjs` | Generates the workflow (`workflows/api.json`) from the files above and deploys it through the n8n API. |
| `n8n/sheet-setup.mjs` | Creates the Google Sheet and its tabs (`Entries`, `Settings`, `Foods`). |
| `infra/` | nginx config and Dockerfile for the static page. |

## Setup

1. Set `N8N_API_URL` and `N8N_API_KEY`. Create Google Sheets and Anthropic credentials in n8n and put their IDs in
   `lib.mjs` and `n8n/build.mjs` (`SHEETS_CREDENTIAL_ID`, `ANTHROPIC_CREDENTIAL_ID`).
2. `node n8n/sheet-setup.mjs` creates the sheet. Secrets (`api_secret`, `dash_token`, `pin`, `sheet_id`) live in
   `~/.calories.json` and are generated on first run; add your own `pin`.
3. `node n8n/build.mjs --deploy` deploys the workflow.
4. Build the page image with `infra/` (the build fills the secrets into `nginx.conf`) and serve it behind HTTPS.

Built with n8n, Claude Haiku, the Google Sheets API, vanilla JS and nginx.
