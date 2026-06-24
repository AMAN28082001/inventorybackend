# Backend Changes — Quotations + B2C/B2B Sales (June 2026)

## Priority: Phone-based customer prefill (quotation + sales)

Frontend B2C/B2B stock-out prefills customer name and **full address** as soon as the agent enters the **10th digit** of the phone number (no need to tab out of the field).

### Lookup order (frontend)

1. `GET /api/quotations/customer-by-phone?phone=...` — **new (primary)**
2. `GET /api/sales/customer-by-phone?phone=...` — **fallback**

Both endpoints must respond quickly (&lt; 500ms typical) because the UI calls them on every completed 10-digit entry.

---

## 1) `GET /api/quotations/customer-by-phone` — **NEW**

**Status:** Implemented in `controllers/quotationController.ts` → `getQuotationCustomerByPhone`  
**Route:** `routes/quotationRoutes.ts` — registered **before** `router.use(authenticate)` and **before** `GET /:quotationId`

**Auth:** Accepts inventory agent JWT (same token as `GET /api/sales/customer-by-phone`) **or** quotation-system JWT (dealer / visitor / account manager). Middleware: `authenticateInventoryOrQuotation`, `authorizeQuotationCustomerByPhone`.

### Request

```http
GET /api/quotations/customer-by-phone?phone=9876543210
Authorization: Bearer <token>
```

Phone normalization (same as sales endpoint):
- Strip non-digits
- Accept `9876543210`, `+919876543210`, `09876543210`

### Logic

1. Normalize phone to 10 digits
2. Apply quotation access scope (same rules as `getQuotations` / `getQuotationById`):
   - Agent/account → mapped `dealerId` only
   - Admin/super-admin → all
   - Account manager → `status = approved` only
   - Visitor → assigned visit quotations only
3. Find `customers` where `mobile` matches normalized phone
4. Load **latest** `quotations` row (`ORDER BY createdAt DESC`) for those `customerId`s within access scope
5. Map customer address to inventory sales address shape

### Response 200

```json
{
  "success": true,
  "source": "quotation",
  "customer": {
    "customer_name": "Ravi Sharma",
    "customer_phone": "9876543210",
    "customer_email": "ravi@example.com",
    "company_name": null,
    "gst_number": null,
    "contact_person": "Ravi Sharma",
    "billing_address": {
      "line1": "Sitapura",
      "line2": "",
      "city": "Jaipur",
      "state": "Rajasthan",
      "postal_code": "302022",
      "country": "India"
    },
    "delivery_address": { "...same as billing..." },
    "delivery_matches_billing": true
  },
  "quotation": {
    "id": "QT-C0FMAY",
    "status": "approved",
    "created_at": "2026-06-18T10:00:00.000Z"
  }
}
```

### Errors

| Code | Body |
|------|------|
| 400 | `{ "success": false, "error": { "code": "VAL_001", "message": "Valid phone query is required" } }` |
| 404 | `{ "success": false, "error": { "code": "RES_001", "message": "Customer not found for this phone" } }` |

### Address field mapping

| DB (`customers`) | API response |
|------------------|--------------|
| `firstName` + `lastName` | `customer_name`, `contact_person` |
| `mobile` | `customer_phone` |
| `email` | `customer_email` |
| `streetAddress` | `billing_address.line1` |
| `city` | `billing_address.city` |
| `state` | `billing_address.state` |
| `pincode` | `billing_address.postal_code` |

---

## 2) `GET /api/sales/customer-by-phone` — Fallback

**Status:** Implemented in `controllers/salesController.ts` → `getCustomerByPhone`  
**Route:** `routes/salesRoutes.ts`

Used when no quotation exists for the phone but prior B2B/B2C sales do.

**June 2026:** This endpoint now tries **quotation lookup first** (same logic as `GET /api/quotations/customer-by-phone`) and falls back to sales history. Frontend can call either endpoint.

```http
GET /api/sales/customer-by-phone?phone=9876543210
```

Returns `customer`, `latest_sale`, `recent_sales` (last 5).

**`customer` block must include address in inventory shape:**

```json
{
  "customer": {
    "customer_name": "ABC Solar",
    "customer_phone": "9876543210",
    "customer_email": "abc@example.com",
    "company_name": "ABC Solar Pvt Ltd",
    "gst_number": "08ABCDE1234F1Z5",
    "contact_person": "Ravi Sharma",
    "billing_address": {
      "line1": "Sitapura",
      "line2": "",
      "city": "Jaipur",
      "state": "Rajasthan",
      "postal_code": "302022",
      "country": "India"
    },
    "delivery_address": { "...": "..." },
    "delivery_matches_billing": true
  }
}
```

Use `line1` / `postal_code` (not only `street` / `pincode`) so the sales form maps fields correctly.

---

## 3) Existing quotation endpoints (unchanged)

| Endpoint | Use |
|----------|-----|
| `GET /api/admin/quotations` | B2C dropdown list |
| `GET /api/quotations/:id` | Full detail when agent selects quotation (e.g. `QT-C0FMAY`) |

---

## 4) Unit-aware stock + multiple PI per phone

### Products

`GET /api/products` must return stable `unit` (`Meters`, `Quantity`, `Pieces`, `MTR`, `NOS`, etc.).

### Sales

- **Do not** enforce unique `customer_phone` on `sales`
- Same customer can have multiple PI/B2B/B2C rows
- Prefill uses **latest** quotation or sale by date

---

## Test plan

| # | Request | Expected |
|---|---------|----------|
| 1 | `GET /quotations/customer-by-phone?phone=<known quotation mobile>` | 200 + full address |
| 2 | Same phone, agent without dealer mapping | 404 or empty scope |
| 3 | Unknown phone | 404 |
| 4 | Phone with sale but no quotation | 404 on quotation endpoint; 200 on sales endpoint |
| 5 | `GET /quotations/QT-XXXX` still works | 200 (route order: `customer-by-phone` before `:id`) |

### curl example

```bash
curl -s "http://localhost:3050/api/quotations/customer-by-phone?phone=9057205471" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## Files changed (inventorybackend)

| File | Change |
|------|--------|
| `controllers/quotationController.ts` | `getQuotationCustomerByPhone`, `resolveQuotationAccessWhere`, `normalizePhoneDigits` |
| `routes/quotationRoutes.ts` | `GET /customer-by-phone` |
| `controllers/salesController.ts` | `getCustomerByPhone` (existing) |

**Deploy:** Push to production so `https://api.inventory.chairbordsolar.com/api/quotations/customer-by-phone` is live.

---

**Frontend mirror doc:** `inventoryfrontend/BACKEND_CHANGES_QUOTATIONS_B2C_SALES.md`
