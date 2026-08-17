# Backend — Admin Users tab + checkbox dashboard access

**Frontend:** Admin → **Users** · access checkboxes · single `/login` · multi-access switch (Quotation / HR / Visitor / …)  
**Code:** `app/dashboard/admin/page.tsx` · `lib/user-access.ts` · `lib/auth-context.tsx` · `components/dashboard-nav.tsx`  
**Reference impl:** `BACKEND_USER_ACCESS.ts`  
**Related:** `BACKEND_ACCOUNT_MANAGEMENT_CRUD_API.md` · **`BACKEND_UNIFIED_USERS_AND_CITY_FILTER.md`** · **`BACKEND_VISIT_TRANSFER.md`** · **`BACKEND_ACCESS_BASED_LISTS.md`**

### No backend needed for these FE-only UI items

- Merging double headers into one nav  
- Quotation area dropdown in the navbar  
- Removing **New Quotation** from the navbar (page button remains)  
- Multi-select city filter UI (client-side) — server `?cities=` is optional (see `BACKEND_UNIFIED_USERS_AND_CITY_FILTER.md`)

Backend work is the **access model + API guards** below, plus **unified user profile** and **city persistence** in `BACKEND_UNIFIED_USERS_AND_CITY_FILTER.md`.

---

Admin manages **all login users** in one **Users** tab:

| Source on FE | API today | Edit path |
|--------------|-----------|-----------|
| Dealers (self-register / dealer accounts) | `GET/PUT /admin/dealers` | **Unified** Create/Edit dialog → full profile + **access checkboxes** |
| Operations (Accounts, Installer, Metering, Final, HR, …) | `GET/POST/PUT /admin/account-managers` | Same unified dialog |
| Visitors | `GET/POST/PUT /admin/visitors` | Same unified dialog (also listed on Users tab) |

One login (`POST /auth/login`). User only sees dashboards in their `access[]`.

Until backend ships, FE keeps `localStorage.userAccessOverrides` (browser-only).

---

## Must ship

| # | Deliverable | If missing |
|---|-------------|------------|
| **A** | `access` column on **dealers** and **ops users** (same keys) | Badges empty; access lost on other devices |
| **B** | `GET /admin/dealers` returns `access` per dealer | Users tab dealer rows show no access chips |
| **C** | `PUT /admin/dealers/:id` accepts `access` / `permissions` | Dealer Edit checkboxes do not persist |
| **D** | `GET/POST/PUT /admin/account-managers` include `access` (+ `role`) | Ops Create/Edit access does not stick |
| **E** | `POST /auth/login` returns `user.access` (+ JWT claim) | Multi-access user sees only legacy single role |
| **F** | Middleware: allow if `role` **or** `access` matches section | 2nd dashboard APIs return AUTH_004 |
| **G** | Quotation + Visitor APIs honor `access` (even when primary role is `hr`) | UI opens Quotation/Visitor but lists empty / AUTH_004 |
| **H** | Unified create/edit full profile on dealers + ops + visitors; admin `access: ["admin"]` only | See `BACKEND_UNIFIED_USERS_AND_CITY_FILTER.md` |
| **I** | Persist `customer.address.city` (service city list); optional list `?cities=` | City filters empty / wrong |
| **V** | Visit dropdown = Visitor-checkbox users; single assign; **Transfer** on Assign form + visit cards | See `BACKEND_VISIT_TRANSFER.md` — e.g. Saurav/`aman4119` must appear |
| **L** | Dealer / visitor **lists** from Admin checkboxes — quotation **union** (HR) + visitor **union** (visits) | See `BACKEND_ACCESS_BASED_LISTS.md` (L4a Jagdish / L4b Saurav) |

Optional: `GET /admin/users` unified list (FE currently merges dealers + account-managers + visitors client-side).

### L) Lists follow Admin checkboxes (not old role tables)

**Full handoff:** [`BACKEND_ACCESS_BASED_LISTS.md`](./BACKEND_ACCESS_BASED_LISTS.md)

FE now filters:

| UI list | Include when |
|---------|----------------|
| Admin dealer filters / charts, HR Manage dealers / Select Dealers | `access` includes **`quotation`** |
| Admin Visitors tab, Visitor Reports filter, Schedule Visit dropdown | `access` includes **`visitor`** (dealers + ops + visitors) |

Backend must:

1. Return `access` / `permissions` on every dealer / visitor / ops list row (**B**, **D**, visitors).
2. Persist checkbox updates on PUT (**C**, **D**, visitors).
3. Prefer `?access=quotation` / `?access=visitor` (and visit union = **V1**).
4. **`GET /hr/dealers?includeAccessUsers=true&access=quotation` must succeed with an HR token** (no admin) and return dealers **+ visitors + ops** with Quotation (e.g. Jagdish).
5. Reject HR pool / visit assign ids that fail eligibility; accept visitor uuid if Quotation-eligible.
6. Calling queue works for that id even if `role` is visitor.

Without **L**, FE can only filter correctly on browsers that have local Admin overrides.

---

## Live FE behavior (what backend must support)

Example user after Admin checks **HR + Quotation + Visitor**:

```json
{
  "role": "hr",
  "access": ["hr", "quotation", "visitor"]
}
```

| FE action | Route | APIs that must allow via `access` |
|-----------|-------|-----------------------------------|
| Open Quotation (navbar dropdown) | `/dashboard` | Dealer/quotation + calling-queue routes |
| Open HR | `/dashboard/hr` | Existing HR routes |
| Open Visitor | `/visitor/dashboard` | `/visitors/me/visits` etc. |

Primary JWT `role` may stay `hr`. Do **not** force login to rewrite role to `dealer` / `visitor`.

---

## Access keys (exact strings)

| Key | Default legacy `role` | Dashboard |
|-----|----------------------|-----------|
| `admin` | `admin` | Admin panel |
| `quotation` | `dealer` | Quotation / customers / payments (dealer nav) |
| `accounts` | `account-management` | Accounts |
| `installation` | `installer` | Installation |
| `metering` | `metering` | Metering |
| `final_confirmation` | `baldev` | Final confirmation |
| `hr` | `hr` | HR |
| `visitor` | `visitor` | Visitor |

FE always sends both `access` and `permissions` (same array). Accept either.

**Default when `access` missing:**

| Existing role | Default `access` |
|---------------|------------------|
| admin / super-admin | `["admin","quotation"]` |
| dealer | `["quotation"]` |
| account-management | `["accounts"]` |
| installer / installation-team | `["installation"]` |
| metering | `["metering"]` |
| baldev | `["final_confirmation"]` |
| hr | `["hr"]` |
| visitor | `["visitor"]` |

---

## A) Schema

```sql
-- Dealers table (or shared users table)
ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS access JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Account-managers / ops users (same shape)
ALTER TABLE account_managers
  ADD COLUMN IF NOT EXISTS access JSONB NOT NULL DEFAULT '[]'::jsonb;

-- If everyone lives in one `users` table, add once there instead.
```

Rules:

1. Store deduped known keys only.
2. On read, if empty → derive from `role` / dealer default `["quotation"]`.
3. Prefer also putting `access` on JWT at login.

---

## B) List dealers (Users tab)

```http
GET /api/admin/dealers?page=1&limit=1000&includeInactive=true
Authorization: Bearer <admin>
```

Each dealer in `dealers[]` (or equivalent) must include:

```json
{
  "id": "uuid",
  "username": "himani",
  "firstName": "Himani",
  "lastName": "Sharma",
  "email": "…",
  "mobile": "…",
  "role": "dealer",
  "access": ["quotation"],
  "isActive": true,
  "emailVerified": true
}
```

Admin username `admin` may return `access: ["admin","quotation"]`.

---

## C) Update dealer (Edit User + checkboxes)

```http
PUT /api/admin/dealers/:id
Authorization: Bearer <admin>
Content-Type: application/json
```

### Body FE sends

```json
{
  "firstName": "Himani",
  "lastName": "Sharma",
  "email": "himani@example.com",
  "mobile": "9876543210",
  "gender": "Female",
  "dateOfBirth": "1990-01-15",
  "fatherName": "…",
  "fatherContact": "9876543211",
  "governmentIdType": "Aadhaar",
  "governmentIdNumber": "…",
  "address": {
    "street": "…",
    "city": "…",
    "state": "Rajasthan",
    "pincode": "302001"
  },
  "isActive": true,
  "emailVerified": true,
  "access": ["quotation", "metering", "admin"],
  "permissions": ["quotation", "metering", "admin"]
}
```

### Rules

1. Keep existing profile field validation.
2. If `access` / `permissions` present → **replace** stored access (dedupe, validate keys).
3. Do **not** reject the whole update only because `access` is present (FE retries without access as fallback — that drops checkbox changes).
4. Username stays immutable.
5. Return updated dealer including `access`.

### Success `200`

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "username": "himani",
    "access": ["quotation", "metering", "admin"],
    "isActive": true
  },
  "message": "Dealer updated successfully"
}
```

### Errors

| Status | Code | When |
|--------|------|------|
| 400 | `VAL_001` | Invalid access key / empty access when provided |
| 404 | `NOT_001` | Dealer not found |
| 401 | `AUTH_003` | Not admin |

---

## D) Operations users (Create / Edit from Users tab)

FE **Create User ID** and ops **Edit** use account-managers:

```http
POST /api/admin/account-managers
PUT  /api/admin/account-managers/:id
GET  /api/admin/account-managers
GET  /api/admin/account-managers/:id
```

### Create body

```json
{
  "username": "rita",
  "password": "securePassword123",
  "firstName": "Rita",
  "lastName": "Shah",
  "email": "rita@example.com",
  "mobile": "9876543210",
  "role": "metering",
  "access": ["quotation", "metering", "accounts"],
  "permissions": ["quotation", "metering", "accounts"]
}
```

### Primary `role` if only `access` sent

Priority: `admin` → `accounts` → `installation` → `metering` → `final_confirmation` → `hr` → `visitor` → `quotation`  
Map to: `admin` / `account-management` / `installer` / `metering` / `baldev` / `hr` / `visitor` / `dealer`.

List/get must echo `access` (derive from `role` if empty).

---

## E) Login

```http
POST /api/auth/login
{ "username": "himani", "password": "…" }
```

```json
{
  "token": "…",
  "refreshToken": "…",
  "user": {
    "id": "uuid",
    "username": "himani",
    "role": "dealer",
    "access": ["quotation", "metering"],
    "permissions": ["quotation", "metering"],
    "isActive": true
  }
}
```

Embed `access` in JWT. Same endpoint for dealers and ops users.

---

## F) Middleware

Allow route if legacy `role` matches **OR** `access` includes the section key.

| APIs | Allow when |
|------|------------|
| Admin | `admin`/`super-admin` **or** `access` has `admin` |
| Dealer quotation | `dealer` **or** `access` has `quotation` |
| Accounts | `account-management` **or** `access` has `accounts` |
| Installation | `installer` / `installation-team` **or** `access` has `installation` |
| Metering | `metering` **or** `access` has `metering` |
| Final confirmation | `baldev` **or** `access` has `final_confirmation` |
| HR | `hr` **or** `access` has `hr` |

Helpers: `BACKEND_USER_ACCESS.ts` → `normalizeAccess`, `accessFromRole`, `canAccessSection`, `requireAccess`.

---

## Optional: unified users list

```http
GET /api/admin/users?page=1&limit=100&search=
```

```json
{
  "users": [
    {
      "id": "…",
      "kind": "dealer",
      "username": "himani",
      "role": "dealer",
      "access": ["quotation"],
      "isActive": true
    },
    {
      "id": "…",
      "kind": "operations",
      "username": "rita",
      "role": "metering",
      "access": ["quotation", "metering"],
      "isActive": true
    }
  ]
}
```

Not required — FE already merges `GET /admin/dealers` + `GET /admin/account-managers`.

---

## Out of scope

- Dealer self-register → still creates dealer; default `access: ["quotation"]`.
- Installation-team logins — separate credentials for now.
- Nav header merge / Quotation dropdown / removing navbar **New Quotation** — FE-only.
- Multi-select city filter UI — FE-only; server `?cities=` is optional.

---

## QA checklist

- [ ] Users tab: dealer row shows access badges from API
- [ ] Edit dealer → check Metering + Quotation → save → reload → badges stick
- [ ] That dealer login → workspace / metering works (no AUTH_004)
- [ ] Uncheck Metering → re-login → metering blocked
- [ ] Create User ID with Accounts + Installation → both work after login
- [ ] Edit ops user access → persists on `GET /admin/account-managers`
- [ ] Old dealer with empty `access` → treated as `["quotation"]`
- [ ] Activate / approve dealer still works
- [ ] `{ "role": "hr", "access": ["hr","quotation","visitor"] }` opens dealer/quotation + visitor APIs without AUTH_004; primary role stays `hr`

---

## Frontend compatibility

| Action | API |
|--------|-----|
| Users list | `GET /admin/dealers` + `GET /admin/account-managers` + `GET /admin/visitors` |
| Create (unified form) | visitors / dealers.register / account-managers |
| Edit dealer | `PUT /admin/dealers/:id` + full profile + `access`/`permissions` |
| Create / Edit ops | `POST` / `PUT /admin/account-managers` + full profile + `access`/`permissions` |
| Edit visitor | `PUT /admin/visitors/:id` + full profile + `access` |
| Login | `POST /auth/login` → `user.access` (+ JWT) |
| Quotation UI (multi-access) | Same dealer/quotation APIs; guard by `access: quotation` |
| Visitor UI (multi-access) | Same visitor APIs; guard by `access: visitor` |
| City on quotation | stored on `customer.address.city` |
| City filter | FE client-side; optional `?cities=` |
| Fallback | `localStorage.userAccessOverrides[username]` |
| Nav-only UI | No API (header merge / remove nav New Quotation) |

---

## G) Multi-access Quotation + Visitor (required now)

**Frontend (live):** User with `access: ["hr","quotation","visitor"]` sees switch bar on HR.  
Click **Quotation** → `/dashboard` (dealer UI). Click **Visitor** → `/visitor/dashboard`.

UI already opens. APIs must not return **AUTH_004** when primary JWT `role` is `hr` (or any other ops role) but `access` includes the section.

### Must ship for this

| # | Deliverable | If missing |
|---|-------------|------------|
| **G1** | Login JWT includes full `access[]` | FE shows tabs; APIs still block |
| **G2** | Dealer/quotation routes allow `access` includes `quotation` | Quotation dashboard empty / AUTH_004 |
| **G3** | Visitor routes allow `access` includes `visitor` | Visitor dashboard empty / AUTH_004 |
| **G4** | Resolve “acting as” user id from JWT `sub` for both | Wrong empty lists |

### Quotation / dealer APIs to open when `access` has `quotation`

Allow if `role === "dealer"` **OR** `access.includes("quotation")` (admin optional):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/dealers/me` | Profile |
| GET | `/dealers/me/statistics` | Dashboard stats |
| GET/POST | `/quotations` … | List / create quotations |
| GET/PUT | `/quotations/:id` … | Quotation detail |
| GET | `/dealers/me/calling-queue/next` | Calling Data |
| GET | `/dealers/me/calling-queue/current` | Current lead |
| POST | `/dealers/me/calling-queue/:id/action` | Lead actions |
| GET | `/dealers/me/calling-actions` | History |
| GET | `/dealers/visitors` | Assign / transfer visit dropdown — visitors **+ dealers + ops** with Visitor checkbox (e.g. Saurav / `aman4119`; see `BACKEND_VISIT_TRANSFER.md`) |
| * | other existing dealer quotation endpoints | Same guard |

**Identity:** use JWT `sub` / `userId` as the dealer actor.  
If the user is ops (`role: hr`) with `quotation` access:

1. Prefer linking to a dealer row with same username, **or**
2. Treat `userId` as the quotation owner id for `createdBy` / `dealerId` filters, **or**
3. Return **their own** quotations only (same as a dealer seeing own data).

Do **not** require `role` to be rewritten to `dealer` on login (FE keeps primary role + access).

### Visitor APIs to open when `access` has `visitor`

Allow if `role === "visitor"` **OR** `access.includes("visitor")`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/visitors/me/visits` | Assigned visits (`status=all`) |
| GET | `/visitors/me/statistics` | Stats |
| POST | `/visitors/visits/:id/complete` | Complete visit |
| POST | `/visitors/visits/:id/upload` | Upload assets |
| * | aliases `/visitors/me/visits/...` | Same guard |

**Identity:** use JWT `sub` as `visitorId` when matching `visit.visitors[].visitorId` (dealer uuid if assigned as a dealer with Visitor access).  
If a dealer/ops user has `visitor` access but is not in `visitors` table:

- Auto-link / create a visitors row **with the same id**, **and**
- Assign visits to that user id the same way as visitor agents.

Empty list `[]` is OK when nothing is assigned; **403 AUTH_004** is not OK.

### Middleware sketch

```ts
// Quotation /dealer routes
requireAnyAccess(["quotation"]) // or role dealer via canAccessSection

// Visitor routes
requireAnyAccess(["visitor"])

// HR routes (unchanged)
requireAnyAccess(["hr"])
```

`canAccessSection` already maps legacy role → default access when JWT omits `access`.

### Example JWT after login

```json
{
  "sub": "user-uuid",
  "username": "hr.rita",
  "role": "hr",
  "access": ["hr", "quotation", "visitor"]
}
```

### QA

- [ ] User access `["hr","quotation"]` → open Quotation → `GET /quotations` or dealer list **200** (not AUTH_004)
- [ ] Create quotation succeeds with that token
- [ ] Calling Data `/dealers/me/calling-queue/*` **200** or empty lead (not 403)
- [ ] User access `["hr","visitor"]` → Visitor → `GET /visitors/me/visits?status=all` **200**
- [ ] User with only `["hr"]` → Quotation/Visitor APIs still **403**
- [ ] Pure dealer / pure visitor unchanged

### Frontend note

FE no longer redirects HR away from `/dashboard` or `/visitor/dashboard` when those keys are in session `access`. Backend must match.

---

## Shipped in this repo (A–I, V, L)

| # | Status | Where |
|---|--------|--------|
| **A–D** | Done | `dealers.access` + `account_managers.access`; GET/PUT dealers; GET/POST/PUT account-managers |
| **E** | Done | `POST /auth/login` → `user.access` + JWT `access[]` |
| **F** | Done | `middleware/authQuotation.ts` — allow if `role` **or** `access` |
| **G** | Done | Quotation + Visitor APIs when `access` has those keys, even if `role` is `hr` |
| **H** | Done | Unified profile on dealers + ops + visitors; admin default `access: ["admin"]` |
| **I** | Done | `customer.address.city` on list/detail; optional `?cities=` |
| **V** | Done | Dropdown = dealers+ops+visitors with Visitor checkbox (e.g. `aman4119`); single assign; Transfer on Assign form + cards (`PATCH /visits/:id/transfer`); `/visitors/me/visits` by assignee id |
| **L** | Done | `GET /hr/dealers` union for **HR token** (e.g. Jagdish visitor+quotation); Visitor union for visits (e.g. `aman4119`); pool/assign reject ineligible ids; queue by assignee id |

See `BACKEND_UNIFIED_USERS_AND_CITY_FILTER.md` · `BACKEND_VISIT_TRANSFER.md` · `BACKEND_ACCESS_BASED_LISTS.md`.
