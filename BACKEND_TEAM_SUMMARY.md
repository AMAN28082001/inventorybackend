# Backend Team Summary

**Last updated:** June 2026

---

## Priority 0 — Stock request dispatch

**Full spec:** [`BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md`](./BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md)  
**Serial GET vs dispatch:** [`BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md`](./BACKEND_SERIAL_NUMBERS_DISPATCH_FIX.md)

### Critical fix — dispatch quantity per line

```text
dispatch_qty = serial_numbers[product_id]?.length ?? request_line.quantity
if (central_stock < dispatch_qty) return 400   // before UPDATE
central_stock -= dispatch_qty                  // NOT requested_qty
```

One line deducting **requested** instead of **serial count** fails the whole dispatch → `products_quantity_check`.

### Multi-item request

| Line | Requested | Serials sent | Must deduct |
|------|-----------|--------------|-------------|
| 6KWP | 2 | 1 | **1** (not 2) |
| 8KWP | 3 | 3 | **3** |
| 10KWP | 2 | 2 | **2** |

### All backend issues

| # | Error / issue | Fix |
|---|----------------|-----|
| 1 | Permission to update | No `PUT` before dispatch |
| 2 | `products_quantity_check` | Deduct `dispatch_qty` only |
| 3 | Insufficient stock on partial | Validate against serial count, not requested |
| 4 | cannot exceed originally requested | Allow `dispatch_qty < requested`; no `items` |
| 5 | Invalid serial | Same lookup on GET and POST |
| 6 | Multi-item partial | Each line independent in one transaction |
| 7 | Serials on meters | Panels & Inverters only |
| 8 | Raw DB errors | `{ error, details[] }` with `product_name` |
| 9 | `serial_numbers` parse | `JSON.parse()` string in JSON body |

**Frontend:** Until backend deploys, UI may block partial dispatch (e.g. 1 of 2 on 6KWP). After deploy, partial works without `items`.

14 test cases + handler pseudocode: [`BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md`](./BACKEND_CHANGES_STOCK_REQUEST_DISPATCH.md).

---

## Priority 1 — Calling queue `LEAD_004`

**Full spec:** [`BACKEND_CHANGES_HANDOFF.md` §3](./BACKEND_CHANGES_HANDOFF.md#3-dealer-calling-queue--lead_004-priority-1) · [`BACKEND_CHANGES_REQUIRED.md` §E](./BACKEND_CHANGES_REQUIRED.md#e--dealer-calling-queue-remarks-tabs-lead_004)

### Problem

| What happens | Why |
|--------------|-----|
| Dealer sees lead on Current Lead (`GET …/calling-queue/next`) | Queue returns pool / round-robin lead |
| **Start Call** or **Submit** fails **`LEAD_004`** | `assigned_dealer_id` null, pool sentinel, or another dealer |
| UI may save locally | **Admin / HR reports miss the call** until backend persists |

### Backend must fix (Option A — implemented)

**`PATCH /api/dealers/me/calling-queue/{leadId}/action`**

| `action` | Backend |
|----------|---------|
| `start` | Pool / unassigned + dealer in HR `dealerIds` → set assignee = JWT dealer, `status = in_progress` |
| `called` / `not_interested` / `follow_up` / `rescheduled` | Auto-claim if needed, persist remark, close lead |
| Any | Another dealer’s `in_progress` lead → **403 `LEAD_004`** |

Optional body (frontend already sends):

```json
{
  "action": "start",
  "claim": true,
  "autoAssign": true,
  "assignedDealerId": "<dealer-uuid-from-jwt>"
}
```

**Also implemented:** Option B (`POST …/claim`, `POST …/assign`, `PATCH …/:leadId`) · Option C (`promoteQueuedLeadIfSlotAvailable` on `GET …/next`).

**Pool assignees:** `unassigned`, `pool`, `open`, `null`, `none`, etc. are claimed on GET promote and on PATCH `start`/submit.

### Submit example (Not Connected → Call Unanswered)

```http
PATCH /api/dealers/me/calling-queue/{leadId}/action
Authorization: Bearer <dealer-jwt>
```

```json
{
  "action": "not_interested",
  "actionAt": "2026-06-05T10:30:00.000Z",
  "callRemark": "[part_1_call_and_lead] Call Unanswered",
  "call_remark": "[part_1_call_and_lead] Call Unanswered",
  "statusCategory": "part_1_call_and_lead",
  "status_category": "part_1_call_and_lead",
  "statusText": "Call Unanswered",
  "status_text": "Call Unanswered"
}
```

**200 must:** assign to current dealer · persist `call_remark` / `status_category` / `status_text` · `status = completed` · return `nextLead`.

### Lead fields (every queue response)

| Field | Rule |
|-------|------|
| `assignedDealerId` | Calling assignee — must match JWT `dealers.id` when set |
| `assignedDealerName` | From `dealers` join |
| `dealerId` | **null** on queue rows — HR/uploader only, not calling assignee |

### Error codes

| Code | HTTP | When |
|------|------|------|
| `LEAD_004` | 403 | Lead owned by another dealer or not in this dealer’s pool |
| `LEAD_005` | 409 | Invalid transition (e.g. submit without start) |

### QA

1. HR uploads CSV with dealer pool including target dealer  
2. Dealer opens Calling Data → sees lead  
3. **Start Call** → 200, `in_progress`, no `LEAD_004`  
4. Submit (Not Connected → Call Unanswered) → 200, remark saved, `nextLead` returned  
5. Admin Calling Reports shows action with correct dealer name  
6. Second dealer cannot claim same `in_progress` lead  

**Code:** `controllers/callingLeadController.ts` — `claimCallingLeadForDealer`, `promoteQueuedLeadIfSlotAvailable`, `updateDealerCallingQueueAction`.

---

## Sales with serial numbers

- Agent selects serials from admin-mapped stock (status `dispatched` or `acknowledged`).
- Backend validates the serials belong to the agent’s admin and are in allowed status.
- Backend sets serials to `sold` and links `sale_id` and `sale_item_id`.

---

## Priority 0.5 — Agent Stock-Out UX (Units + Prefill + Multiple PI)

**Full spec:** [`BACKEND_CHANGES_QUOTATIONS_B2C_SALES.md`](./BACKEND_CHANGES_QUOTATIONS_B2C_SALES.md)

### Unit-aware stock labels

- Product APIs must always return stable `unit` for stock rows (`Meters`, `Quantity`, `Pieces`, etc.).
- `GET /api/products` and `GET /api/products/:id` already serialize `unit`.
- `GET /api/products/inventory-levels` must also include `unit` so stock-out UI can render `900 Meters` / `69 Quantity` consistently.

### Phone-based customer prefill

- Added endpoint:
  - `GET /api/sales/customer-by-phone?phone=...`
- Behavior:
  - Normalizes phone (10-digit India format) and finds recent matching sales.
  - Returns:
    - `customer` profile block for prefill (`customer_name`, `customer_phone`, `customer_email`, `type`, `company_name`, `gst_number`, `contact_person`, address fields, instructions, notes)
    - `latest_sale` full row
    - `recent_sales` compact history list

### Multiple PI/sales per customer phone

- Do **not** enforce unique phone in sales creation.
- Current sales model has no unique index on `customer_phone`; repeated B2B/B2C sales for same phone are valid.
- Prefill endpoint uses latest sale as default while preserving historical records.

---

## Priority 0.6 — Meter serial numbers optional

**Full spec:** [`BACKEND_CHANGES_METER_SERIAL_OPTIONAL.md`](./BACKEND_CHANGES_METER_SERIAL_OPTIONAL.md)

### Rule

| Category | Serials |
|----------|---------|
| Panels / Inverters | **Required** on create, add stock, dispatch |
| Meters | **Never** |
| Others (cables, etc.) | Optional |

### Endpoints

| Endpoint | Meter behavior |
|----------|----------------|
| `POST /api/products` | `quantity > 0`, no `serial_numbers` → **201** |
| `PUT /api/products/:id` | Metadata-only edit → **200** (no serial re-validation) |
| `PUT /api/products/:id` | `stock_to_add` without serials → qty only |
| `POST /api/stock-requests/:id/dispatch` | Omit meter from `serial_numbers` map |

**Helper:** `utils/productSerialLookup.ts` → `requiresSerialNumbers(category, productName)`

**Frontend:** Already aligned; deploy backend to clear `Serial numbers are required for this category` on Meter edit/create.

---

## Priority 1.1 — Calling Scheduled tab (multi-device sync)

**Full spec:** [`BACKEND_CHANGES_HANDOFF.md` §4](./BACKEND_CHANGES_HANDOFF.md#4-dealer-calling-queue--remarks) · [`BACKEND_CHANGES_REQUIRED.md` §E](./BACKEND_CHANGES_REQUIRED.md#e--dealer-calling-queue-remarks-tabs-lead_004)

### Must-have

| # | Endpoint | Behavior |
|---|----------|----------|
| 1 | `GET /dealers/me/calling-queue/next` & `/current` | `scheduledLeads` — deduped, includes `nextFollowUpAt`, `call_remark`, `statusCategory`, `statusText`, `remark` |
| 2 | `PATCH …/calling-queue/:leadId/action` | `rescheduled` / `follow_up` + `nextFollowUpAt` → persist remark fields, `status: rescheduled` |
| 3 | Tab arrays | Scheduled rows excluded from `dialledActions` / `connectedActions` / `notConnectedActions` |
| 4 | `GET /dealers/me/calling-actions?limit=2000` | Dealer-scoped action history (same shape as HR) |

**Note:** `upcomingFollowUps` and `rescheduledLeads` return `[]` — canonical list is `scheduledLeads` only.
