# Google Sheets — Social Media Leads (HR Panel)

**Spreadsheet:** `https://docs.google.com/spreadsheets/d/18zqPIpa3fcjRvfNqdm3FPC10bszPIPHbv5F3-TMk0A0`

**Reference implementation:** `BACKEND_GOOGLE_SHEETS_SOCIAL_LEADS.ts`  
**Frontend:** `lib/google-sheets-social-leads.ts`, `components/hr-social-media-sheets-panel.tsx`, HR → **Social Media** tab

---

## Security (read first)

1. **Never commit** the service account JSON to git or the frontend repo.
2. If credentials were shared in chat/email, **rotate the key** in Google Cloud Console.
3. Store credentials only on the **backend server**:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — full JSON string in env, **or**
   - `GOOGLE_APPLICATION_CREDENTIALS` — path to JSON file
4. Share the spreadsheet with the service account email (`client_email` in JSON) as **Editor**.

---

## Product behaviour

| Feature | Detail |
|---------|--------|
| Sheet tabs | **Live sheet only** — currently `Jaipur Leads`, `Ajmer Leads`, `Crompton Leads`, `Ajmer Solar Lead Form New` → HR sub-tabs when enabled |
| Discover | Upsert live tabs + **delete** DB rows for tabs removed/renamed in Google Sheets (UI must match sheet 1:1) |
| Toggle | When **ON**, dealer checkbox pool appears (same as CSV Assignment) |
| Sync | Pulls new rows from Google Sheet → database → round-robin assign (`active_cap`, default 1/dealer) |
| Colours | Lead cards use `lead_status`, remarks, final decision (sky=new, amber=pending, rose=not interested, green=visit/interested) |
| Calling | Assigned leads appear in **Calling Data** like CSV uploads |
| Dedupe | By mobile per sheet source / upload batch |

---

## Sheet columns (Meta export — live `Ajmer Solar Lead Form New`)

Live Meta Lead Form headers (also used on tabs like `Ajmer Leads`):

`id`, `created_time`, `ad_id`, `ad_name`, `adset_id`, `adset_name`, `campaign_id`, `campaign_name`, `form_id`, `form_name`, `is_organic`, `platform`, `full_name`, `phone_number`, `lead_status`

**Meta column map (P0):**

| Sheet | DB / API | Role |
|-------|----------|------|
| `phone_number` → last 10 digits | `mobile` | **Required** — skip row if invalid |
| `id` | `external_id` | **Required** — dedupe key |
| `full_name` | `name` | **Required** |
| `lead_status` | `lead_status` | **Required** — `CREATED` = New |
| `platform`, `campaign_name`, `ad_name`, `created_time` | same | Optional |
| `form_name`, `adset_name` | `customer_note` only | Optional enrich |
| `ad_id`, `adset_id`, `campaign_id`, `form_id`, `is_organic` | — | Ignore (kept in `raw` / `raw_json`) |
| Ops cols if present (`Remarks`, `KW`, `NAME`, call responses, Final Decision…) | same | Optional |

**Assign:** use `hr_sheet_sources.dealer_ids` + `active_cap` after sync — **not** sheet columns.

**API echo on lead rows** (`GET /hr/sheet-sources/:id/leads`):  
`mobile`, `name`, `leadStatus`, `finalDecision`, `remarks`, `platform`, `campaignName`, `adName`, `assignedDealerId`, `assignedDealerName`, `externalId`

---

## Database

### `hr_sheet_sources`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `spreadsheet_id` | string | Google spreadsheet ID |
| `sheet_tab_name` | string | e.g. `Ajmer_Leads` |
| `display_name` | string | UI label |
| `enabled` | boolean | Toggle in HR |
| `dealer_ids` | JSON array | Round-robin pool |
| `active_limit_per_dealer` | int | Default 1 |
| `last_synced_row` | int | 1-based row cursor after header |
| `last_synced_at` | timestamp | |
| `last_sync_status` | string | `ok` / `error` |
| `last_sync_error` | text | |
| `upload_id` | UUID | Latest `hr_lead_uploads` batch |

### Extend `hr_leads` (or `hr_social_leads`)

Add social fields + link `sheet_source_id`, `external_id`, `sheet_row_index`, `raw_json`.

Reuse `hr_lead_uploads` with `source_type = 'google_sheet'`, `file_name = 'Google Sheet: Ajmer_Leads'`.

---

## API endpoints

All paths are under your API prefix (e.g. `/api/hr/...`). Frontend calls without `/api` when `NEXT_PUBLIC_API_URL` already includes it.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/hr/sheet-sources` | List sources + counts — **only tabs for the current spreadsheet** (after Discover: same set as live Google tabs) |
| `POST` | `/hr/sheet-sources/discover` | `{ spreadsheetId }` → upsert live tabs; **delete** stale DB rows; return live `tabs` + `sources` |
| `PATCH` | `/hr/sheet-sources/:id` | `{ enabled, dealerIds, activeLimitPerDealer }` |
| `POST` | `/hr/sheet-sources/:id/sync` | Pull sheet → DB → assign (manual Sync now) |
| `POST` | `/hr/sheet-sources/sync-all` | **P0 auto-sync** — all `enabled=true` tabs; HR JWT **or** `x-cron-secret`; emit socket |
| `GET` | `/hr/sheet-sources/:id/leads` | Paginated rows for UI table |

**Auth:** `hr` role (same as CSV upload). Sync-all also accepts `x-cron-secret: $CRON_SECRET`.

**Socket:** emit `calling:uploads-updated` after sync (HR + dealer queues refresh). Register **`sync-all` before `/:id` routes**.

---

## Auto-sync every 15 minutes (P0) + socket for UI

Google Sheets **cannot push** into our app. A WebSocket alone cannot replace polling the sheet.

| Layer | Role |
|-------|------|
| **Backend cron (every 15 min)** | Pulls enabled tabs via `POST /hr/sheet-sources/sync-all` |
| **Socket `calling:uploads-updated`** | After cron/manual sync → HR + dealer UIs refresh (`reason: sheet_auto_sync`) |
| **Manual Sync now** | Immediate pull when HR needs it now |
| **SPA 15‑min soft refresh** | Fallback if socket was missed |

```bash
*/15 * * * * curl -sS -X POST "$API_BASE/hr/sheet-sources/sync-all" \
  -H "x-cron-secret: $CRON_SECRET" -H "Content-Type: application/json" -d '{}'
```

```env
CRON_SECRET=long-random-string
GOOGLE_SHEETS_SPREADSHEET_ID=18zqPIpa3fcjRvfNqdm3FPC10bszPIPHbv5F3-TMk0A0
```

---

### Response shapes (camelCase — SPA normalizers accept snake_case too)

**GET `/hr/sheet-sources`**

```json
{
  "success": true,
  "sources": [
    {
      "id": "uuid",
      "spreadsheetId": "18zqPIpa3fcjRvfNqdm3FPC10bszPIPHbv5F3-TMk0A0",
      "sheetTabName": "Ajmer_Leads",
      "displayName": "Ajmer Leads",
      "enabled": true,
      "dealerIds": ["dealer-uuid-1"],
      "activeLimitPerDealer": 1,
      "rowCount": 120,
      "assignedCount": 5,
      "unassignedCount": 100,
      "completedCount": 25,
      "lastSyncedAt": "2026-02-04T10:00:00.000Z",
      "lastSyncStatus": "ok",
      "uploadId": "upload-uuid"
    }
  ]
}
```

**POST `/hr/sheet-sources/discover`**

```json
{
  "success": true,
  "tabs": ["Jaipur Leads", "Ajmer Leads", "Crompton Leads", "Ajmer Solar Lead Form New"],
  "data": {
    "spreadsheetId": "18zqPIpa3fcjRvfNqdm3FPC10bszPIPHbv5F3-TMk0A0",
    "tabs": ["Jaipur Leads", "Ajmer Leads", "Crompton Leads", "Ajmer Solar Lead Form New"]
  }
}
```

Discover must prune: any `hr_sheet_sources` / `calling_lead_sheet_sources` row for this `spreadsheet_id` whose `sheet_tab_name` is **not** in the live Google title list is **deleted**.

**POST `/hr/sheet-sources/:id/sync`**

```json
{
  "success": true,
  "data": { "imported": 12, "skipped": 3, "uploadId": "upload-uuid" }
}
```

**GET `/hr/sheet-sources/:id/leads`**

```json
{
  "success": true,
  "data": {
    "leads": [
      {
        "id": "lead-uuid",
        "externalId": "l:2131847664877656",
        "name": "Bhupender Kumar",
        "mobile": "8955276223",
        "leadStatus": "CREATED",
        "remarks": "",
        "finalDecision": "",
        "platform": "ig",
        "campaignName": "Camp Ajmer",
        "adName": "Lead Ad_Ajmer-1",
        "assignedDealerId": "dealer-uuid",
        "assignedDealerName": "Moomal",
        "raw": { }
      }
    ],
    "pagination": { "page": 1, "limit": 50, "total": 120 }
  }
}
```

---

## Assignment

Reuse existing allocator from `BACKEND_ASSIGN_UNASSIGNED.ts`:

- `assignmentMode: active_cap`
- `activeLimitPerDealer: 1` (match HR CSV default)
- `dealerIds` from sheet source config when toggle is ON

---

## Environment variables (backend)

```env
GOOGLE_SHEETS_SPREADSHEET_ID=18zqPIpa3fcjRvfNqdm3FPC10bszPIPHbv5F3-TMk0A0
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
# OR
GOOGLE_APPLICATION_CREDENTIALS=/secure/path/service-account.json
```

**npm:** `googleapis` on backend only.

---

## Google Cloud setup

1. Create service account in GCP project.
2. Enable **Google Sheets API**.
3. Download JSON key → store in env (not in repo).
4. Open spreadsheet → Share → add `client_email` from JSON as **Editor**.
5. Verify `GET discover` returns tab list including `Ajmer_Leads`.

---

## QA checklist

- [ ] Discover returns all tabs (`Ajmer_Leads`, …)
- [ ] Enable tab + select dealers → PATCH saves pool
- [ ] Sync imports rows with valid 10-digit mobile
- [ ] Duplicate mobile on re-sync → skipped
- [ ] Assigned count follows active_cap (1 per dealer)
- [ ] HR Social Media table shows coloured status badges
- [ ] Dealer Calling Data shows assigned social leads
- [ ] `GET /hr/leads/uploads` includes sheet batches (`source_type=google_sheet`)
- [ ] Credentials not in frontend bundle or git

---

## Related docs

- `BACKEND_CHANGES_HANDOFF.md` §41
- `BACKEND_CHANGES_REQUIRED.md` §AN
- `BACKEND_ASSIGN_UNASSIGNED.ts` — round-robin
- `BACKEND_ADMIN_QUOTATION_STATUS.ts` — `hr_leads` / uploads
