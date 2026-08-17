# Backend — Dealer & visitor lists from Admin access checkboxes

**Frontend (live):** Lists follow **Admin → Users** checkboxes (`access[]`), not “everyone in dealers/visitors table”.

**Code:** `app/dashboard/admin/page.tsx` · `app/dashboard/hr/page.tsx` · `components/visit-management-dialog.tsx` · `lib/user-access.ts` · `lib/visitor-assignable-directory.ts` · `lib/quotation-assignable-directory.ts`  
**Related:** `BACKEND_USER_ACCESS.md` (A–D, V, L) · `BACKEND_VISIT_TRANSFER.md` · `BACKEND_MANAGE_DEALERS.md` (F)

---

## Problem (old scenario)

| Old BE behaviour | Wrong UI result |
|------------------|-----------------|
| `GET /hr/dealers` / `GET /admin/dealers` = **dealers table only** | Visitor with Quotation checked (e.g. **Jagdish Prasad Yadav**) missing from HR Select/Manage dealers |
| `GET /dealers/visitors` = visitors table only | Dealer with Visitor checked (e.g. Saurav / `aman4119`) missing from Schedule Visit |
| List rows omit `access` | FE cannot filter; wrong people on other devices |
| Pool / assign accept any id | Non-eligible users saved into pools / visits |

## Still broken without this backend (confirmed)

| Case | Admin UI | HR Select / Manage dealers |
|------|----------|----------------------------|
| **Jagdish** (`jpyadav5793`) — visitor row, checkboxes **Visitor + Quotation** | Visible with Quotation badge | **Missing** on other devices / when HR cannot call admin APIs |

FE workarounds (same-browser Admin sync, soft-merge `/admin/visitors`) are **not enough**: HR tokens often get **403** on admin routes. Backend must ship **L4a** for HR.

| # | Symptom |
|---|---------|
| **E** | Dealer `GET …/calling-queue/next` claims next Unassigned after Complete — dealer stuck after finishing 1 lead |
| **F** | Quotation-assignable **union** for HR + `access` on rows; pool accepts visitor/ops uuids with `"quotation"`; reject others — Jagdish-style users missing; non-quotation ids accepted |
| **F** | Quotation-assignable **union on `GET /hr/dealers`** (HR token, not admin-only); include visitors/ops with `"quotation"`; pool accepts their uuids — Jagdish missing for HR login; pool rejects visitor uuid |

---

## Must ship

| # | Deliverable | If missing |
|---|-------------|------------|
| **L1** | Persist `access` / `permissions` on dealers, visitors, account-managers | Checkboxes lost |
| **L2** | Every list/get user row returns `access` + `permissions` | FE filters fail across devices |
| **L3** | `PUT`/`PATCH` accepts `access` / `permissions` | Admin uncheck does not stick |
| **L4a** | **`GET /hr/dealers?includeAccessUsers=true&access=quotation`** = union (dealers **+ visitors + ops**) for **HR token** | Jagdish missing from HR |
| **L4b** | **Visitor assignable union** (dealers + visitors + ops with `"visitor"`) for visits | Same as V1 — dealer-kind with Visitor missing |
| **L5** | HR pool + visit assign/transfer reject ineligible ids | Bad ids saved |
| **L6** | Calling queue / visit “me” resolve by assignee **entity id** even if role ≠ dealer/visitor | Assigned user never sees leads/visits |

L1–L3 = **A–D** in `BACKEND_USER_ACCESS.md`. This doc is the **list union + enforce** contract.

---

## Access keys

| Checkbox | `access` value | Lists |
|----------|----------------|-------|
| Quotation | `"quotation"` | HR Select/Manage dealers, Admin dealer filters |
| Visitor | `"visitor"` | Admin Visitors tab, Schedule Visit / Transfer |

Legacy when `access` empty/null:

| `role` | Default |
|--------|---------|
| `dealer` | `["quotation"]` |
| `visitor` | `["visitor"]` |
| admin | `["admin"]` only |

If `access` is present and missing the key → **exclude**.

---

## L2) Response shape (every user row)

```json
{
  "id": "uuid",
  "username": "jpyadav5793",
  "firstName": "jagdish prasad",
  "lastName": "yadav",
  "email": "…",
  "mobile": "…",
  "isActive": true,
  "role": "visitor",
  "access": ["visitor", "quotation"],
  "permissions": ["visitor", "quotation"]
}
```

Required on:

```http
GET /api/admin/dealers
GET /api/admin/visitors
GET /api/admin/account-managers
GET /api/hr/dealers
GET /api/dealers/visitors
```

---

## L4a) Quotation-assignable list for HR — **ship this**

### Endpoint (HR must succeed — not admin-only)

```http
GET /api/hr/dealers?isActive=true&includeAccessUsers=true&access=quotation
Authorization: Bearer <HR token>
```

**Do not** require an admin token. FE today tries `/admin/visitors` as fallback and often gets **403** for HR login.

Aliases: `GET /api/hr/assignable-dealers`, `/hr/dealer-pool`, `/hr/assignment/dealers`.

Union always runs for this route (query flags are optional; older FE that omits them still gets dealers + visitors + ops).

### Union (who to include)

| Source | Rule |
|--------|------|
| Dealers | `isActive` and (`access` includes `"quotation"` **or** empty access → legacy dealer) |
| **Visitors** | `isActive` and `access` includes `"quotation"` — **Jagdish** |
| Account-managers / ops | `isActive` and `access` includes `"quotation"` |

### Exclude

- `access` present without `"quotation"`
- `isActive === false`
- Admin-only (`["admin"]`)

### Dedupe

By normalized `username` (trim, lower-case, strip trailing `@`).  
If the same person exists in two tables, prefer the row that **has** `"quotation"` and the richest profile (name/mobile). Quote-link stub dealer rows are omitted so the visitor uuid is returned.

### Response

```json
{
  "success": true,
  "data": {
    "dealers": [
      {
        "id": "visitor-uuid-of-jagdish",
        "username": "jpyadav5793",
        "firstName": "jagdish prasad",
        "lastName": "yadav",
        "mobile": "9571585751",
        "email": "jpyadav5793@gmail.com",
        "isActive": true,
        "role": "visitor",
        "access": ["visitor", "quotation"],
        "permissions": ["visitor", "quotation"]
      }
    ]
  }
}
```

Return the **real entity id** (visitor uuid is OK). FE saves that id into `dealerIds[]`. Each row includes **L2** `access` / `permissions`. Pagination is included so FE page loops stop (`pagination.totalPages`).

---

## L4b) Visitor-assignable list (visits) — same pattern

```http
GET /api/dealers/visitors?isActive=true&includeAccessUsers=true&access=visitor
```

Union: visitors + dealers + ops with `"visitor"`.  
Full detail: `BACKEND_VISIT_TRANSFER.md` **V1**.

---

## L5) Enforce on write

### HR pool

```http
PATCH /api/hr/leads/uploads/:uploadId/dealers
{ "dealerIds": ["uuid-…"], "mode": "replace" }
```

1. Each id must pass **L4a** (visitor uuid with quotation = **valid**).
2. Reject others → `400` / `VAL_001`.
3. Do **not** reject solely because id is not in the dealers table.

### Visit assign / transfer

`visitorId` must pass **L4b**. Dealer uuid with visitor access is valid.

---

## L6) Downstream by assignee id

After HR assigns a **visitor-uuid** (with quotation) into the pool:

- That user must receive leads via calling-queue / next when they log in with Quotation (or combined) access.
- Do **not** require `role === "dealer"` only.

After visit assign to a **dealer-uuid** (with visitor):

- `GET /visitors/me/visits` must return those visits when `access` includes `"visitor"`.

---

## Auth

| Endpoint | Allow if |
|----------|----------|
| Admin user APIs | admin / `access: admin` |
| `GET /hr/dealers` (union) | hr / `access: hr` / admin |
| `GET /dealers/visitors` (union) | dealer/admin **or** `access` has `quotation` / `admin` |
| Pool replace | hr + eligibility on ids |
| Visit assign/transfer | quotation ownership + visitor eligibility |

---

## QA

- [ ] Login as **HR** (not admin) → `GET /hr/dealers?includeAccessUsers=true&access=quotation` includes **Jagdish** with `access` containing `quotation`
- [ ] HR Select Dealers + Manage dealers show Jagdish without opening Admin first
- [ ] Uncheck Quotation on Jagdish in Admin → he disappears from HR after refresh on **any** device
- [ ] Save pool with Jagdish’s **visitor** uuid → `200`; he can pull leads from calling queue
- [ ] Save pool with visitor-only (no quotation) id → `400`
- [ ] Saurav (`aman4119`, dealer + Visitor) → Schedule Visit dropdown
- [ ] Every user list row returns `access` / `permissions`

---

## FE compatibility

| Action | API |
|--------|-----|
| HR quotation directory | Prefers `GET /hr/dealers?…&access=quotation` (**needs L4a**, HR token). Also soft-tries `/admin/visitors`, `/admin/account-managers`, `/dealers/visitors` |
| Visit assignable | `GET /dealers/visitors?includeAccessUsers=true&access=visitor` |
| Persist checkboxes | `PUT` dealers / visitors / account-managers with `access` + `permissions` |
| HR pool save | `PATCH …/dealers` — quotation-eligible ids (any table) |
| Visit assign/transfer | visitor-eligible `visitorId` (any table) |

FE fallback (not a substitute for L4a/L4b): local directories synced from Admin → Users on the same browser.

---

## Shipped in this repo

| # | Status |
|---|--------|
| **L1–L3** | Persist + return `access`/`permissions` on dealers, visitors, ops |
| **L4a** | `GET /hr/dealers` with **HR token** (no admin) = dealers + visitors + ops with Quotation (e.g. Jagdish) |
| **L4b** | `GET /dealers/visitors` = dealers + visitors + ops with Visitor (e.g. Saurav / `aman4119`) |
| **L5** | HR pool accepts visitor/ops uuid with Quotation; rejects others. Visit assign/transfer same for Visitor |
| **L6** | Calling queue resolves assignee id even if `role` is visitor; `/visitors/me/visits` even if `role` is dealer |
