# Backend — Unified Users create/edit + City filter

**Frontend (live):** Admin → **Users** (dealers + ops + visitors) · one Create/Edit dialog for all · city dropdown on quotation create · multi-select city filters on lists  
**Code:** `app/dashboard/admin/page.tsx` · `components/customer-details-form.tsx` · `components/city-multi-select-filter.tsx` · `lib/service-cities.ts` · `lib/user-access.ts`  
**Related:** `BACKEND_USER_ACCESS.md` · `BACKEND_USER_ACCESS.ts`

---

## Must ship

| # | Deliverable | If missing |
|---|-------------|------------|
| **H1** | Admin login `access` is **`["admin"]` only** (never auto-add `quotation`) | Admin sees Workspace / Quotation cards |
| **H2** | Unified create/update accepts **full profile** on dealers, account-managers, visitors | Extra fields silently dropped; edit reopens empty |
| **H3** | Visitors appear with `access` (default `["visitor"]`) on list/get | Users tab visitor chips wrong / empty |
| **H4** | Create routes by primary access: dealer / visitor / ops | Wrong API or 400 on Create User ID |
| **I1** | Persist customer/lead **`address.city`** from service city list | City filters match nothing |
| **I2** *(optional)* | List APIs accept `cities` / `city` multi query param | Large lists stay FE-only filtered |

---

## H) Unified Users (Create / Edit)

### FE behavior

One dialog for **Create User ID** and **Edit** (dealers, ops, visitors):

1. Dashboard **access[]** checkboxes (same keys as `BACKEND_USER_ACCESS.md`)
2. Login: `username`, `password` (required on create; optional on edit)
3. Personal: `firstName`, `lastName`, `email`, `mobile`, `gender`, `dateOfBirth`, `fatherName`, `fatherContact`, `governmentIdType`, `governmentIdNumber`
4. Optional: `employeeId` (visitors / staff)
5. Address: `{ street, city, state, pincode }`
6. On edit: `isActive`, `emailVerified` when applicable

### Create routing (FE today)

| Primary access / role | API called |
|-----------------------|------------|
| `visitor` | `POST /admin/visitors` |
| `dealer` / Quotation-only | `POST /dealers/register` then activate + `PUT /admin/dealers/:id` with `access` |
| Everything else (accounts, installation, metering, final, hr, admin, …) | `POST /admin/account-managers` |

### Update routing (FE today)

| Kind | API |
|------|-----|
| Dealer | `PUT /admin/dealers/:id` |
| Visitor | `PUT /admin/visitors/:id` (+ password endpoint if password set) |
| Operations | `PUT /admin/account-managers/:id` (+ password endpoint if password set) |

### Request body (accept on create + update)

```json
{
  "username": "string",
  "password": "string",
  "firstName": "string",
  "lastName": "string",
  "email": "string",
  "mobile": "10 digits",
  "gender": "Male | Female | Other",
  "dateOfBirth": "YYYY-MM-DD",
  "fatherName": "string",
  "fatherContact": "10 digits",
  "governmentIdType": "Aadhaar Card | PAN Card | …",
  "governmentIdNumber": "string",
  "employeeId": "string | null",
  "address": {
    "street": "string",
    "city": "Jaipur",
    "state": "Rajasthan",
    "pincode": "6 digits"
  },
  "access": ["quotation", "hr"],
  "permissions": ["quotation", "hr"],
  "role": "dealer | visitor | account-management | installer | metering | baldev | hr | admin",
  "isActive": true,
  "emailVerified": false
}
```

Rules:

1. Store unknown-safe extras; do not 400 solely because ops/visitor historically had fewer columns — add nullable columns or JSON `profile`.
2. Always accept `access` **and** `permissions` (same array).
3. Primary admin user / `role: admin` → default `access: ["admin"]` only (no `quotation`).
4. Visitor default when `access` empty → `["visitor"]`.
5. Dealer default when `access` empty → `["quotation"]`.

### Preferred long-term (optional)

```http
POST /api/admin/users
PUT  /api/admin/users/:id
GET  /api/admin/users?page=1&limit=1000
```

Single table or facade that creates the right underlying entity from `access` / `role`. FE can keep today’s three APIs until this exists.

### Response (list + get)

Return the same profile fields so Edit can prefill:

```json
{
  "id": "uuid",
  "username": "…",
  "firstName": "…",
  "lastName": "…",
  "email": "…",
  "mobile": "…",
  "gender": "…",
  "dateOfBirth": "…",
  "fatherName": "…",
  "fatherContact": "…",
  "governmentIdType": "…",
  "governmentIdNumber": "…",
  "employeeId": "…",
  "address": { "street": "…", "city": "…", "state": "…", "pincode": "…" },
  "access": ["visitor"],
  "role": "visitor",
  "isActive": true,
  "emailVerified": false,
  "visitCount": 12
}
```

Users tab merges:

- `GET /admin/dealers`
- `GET /admin/account-managers`
- `GET /admin/visitors`

---

## H1) Admin access default

```json
{ "role": "admin", "access": ["admin"] }
```

Do **not** return `["admin","quotation"]` for username `admin` / role `admin`.  
Login must land on Admin Panel (no workspace chooser).

---

## I) City list + filters

### Canonical city list (FE: `lib/service-cities.ts`)

Quotation create City dropdown and multi-select filters use this exact set (Rajasthan service cities):

`Ajmer, Alwar, Banswara, Baran, Barmer, Beawar, Bharatpur, Bhilwara, Bikaner, Bundi, Chittorgarh, Chomu, Churu, Dausa, Dholpur, Dungarpur, Hanumangarh, Jaipur, Jaisalmer, Jalore, Jhalawar, Jhunjhunu, Jodhpur, Karauli, Kota, Nagaur, Pali, Pratapgarh, Rajsamand, Sawai Madhopur, Sikar, Sirohi, Sri Ganganagar, Tonk, Udaipur`

### Persist on create / update quotation + customer

- Customer `address.city` must be stored **exactly** as submitted (prefer values from the list).
- Calling leads: keep `city` field populated the same way when leads are created/updated.
- `GET` quotation / customer / lead must return city under one of:

  - `customer.address.city` (preferred for quotations)
  - `address.city`
  - `city` / `customerCity` / `customer_city` / `leadCity`

FE reads via `getRecordCity()` in `lib/service-cities.ts`.

### Optional server-side filter (recommended for large lists)

Accept multi-city on list endpoints used by Admin / Dealer / Accounts / Calling:

```http
GET /api/admin/quotations?cities=Jaipur,Jodhpur,Udaipur
GET /api/quotations?cities=Jaipur,Kota
GET /api/admin/customers?cities=Jaipur
GET /api/dealers/me/calling-queue?cities=Jaipur,Sikar
```

Also accept:

- `city=Jaipur&city=Jodhpur` (repeated), or
- `city=Jaipur,Jodhpur`

Semantics:

- No `cities` / `city` → no city filter
- Match **case-insensitive** equality on customer/lead city
- Rows with empty city are **excluded** when a city filter is present

Until this ships, FE filters client-side after load.

### Optional catalog endpoint

```http
GET /api/meta/service-cities
→ { "cities": ["Ajmer", "Alwar", …] }
```

Not required while FE embeds `SERVICE_CITIES`. Useful if the list will be admin-editable later.

---

## QA checklist

- [ ] Create User with Quotation → dealer exists, `access: ["quotation"]`, full address returned on GET
- [ ] Create User with Visitor → visitor exists, `access: ["visitor"]`, employeeId + address round-trip
- [ ] Create User with Accounts + Installation → ops user; both access keys on login JWT
- [ ] Edit dealer / visitor / ops → all profile fields prefilled and save persists
- [ ] Admin login → `access: ["admin"]` only; no workspace
- [ ] New quotation with City = Jaipur → list APIs return `customer.address.city: "Jaipur"`
- [ ] Multi city filter (FE) shows only selected cities; optional API `?cities=` matches same

---

## FE compatibility summary

| Action | API |
|--------|-----|
| Users list | `GET /admin/dealers` + `GET /admin/account-managers` + `GET /admin/visitors` |
| Create (unified form) | visitors / dealers.register / account-managers as above |
| Edit (unified form) | PUT dealers / visitors / account-managers + full profile + `access` |
| City on quotation | stored on `customer.address.city` |
| City filter | FE client-side now; optional `cities` query later |

---

## Shipped in this repo

| # | Status |
|---|--------|
| **H1** | Admin default `access: ["admin"]` only (`utils/userAccess.ts`) |
| **H2** | Full profile on dealers (existing) + account-managers + visitors |
| **H3** | Visitors list/get/login return `access` (default `["visitor"]`) |
| **H4** | Create still uses visitors / dealers.register / account-managers (FE routing); ops accepts `role: admin` |
| **I1** | Quotation/customer GET returns `customer.address.city` |
| **I2** | `GET /quotations`, `GET /admin/quotations`, `GET /customers` accept `?cities=` / `?city=` |

Migration: `20260812180000-add-unified-user-profile-fields.js` (also ensured on bootstrap).
