# Backend — Property Documents (PDF) is **optional** — Jul 2026

**Frontend (already done):** Document Submission on Dashboard / Quotations no longer marks or validates `propertyDocumentPdf` as required. Submit works without that file.

**Backend:** `PATCH /api/quotations/{quotationId}/documents` (and the same KYC handler on `POST`) must **not** reject requests that omit `propertyDocumentPdf`.

---

## Change required

| Item | Action | Status |
|------|--------|--------|
| Zod / schema for document PATCH | `propertyDocumentPdf` **not** required | **Done** (`optionalMediaRef` in `quotationDocumentsSchema`) |
| Business rules (“all KYC docs present”) | Do **not** treat missing property PDF as incomplete | **Done** — KYC checks only `phoneNumber`, `emailId`, `electricityKno` |
| HTTP **400** when PDF absent | **Stop** returning this for `propertyDocumentPdf` | **Done** |
| Storage | Never uploaded → `null`; no placeholder | **Done** (nullable column + partial merge) |
| Still allowlist the field | Accept + store when uploaded | **Done** (multer + S3) |

### Still required (unchanged)

Dealer / account-management KYC submit still requires text:

- `phoneNumber`, `emailId`, `electricityKno`

Product may still expect Aadhaar / PAN / bill / passbook images in the UI; backend does **not** currently hard-require those file parts on PATCH (partial upsert). Only **property PDF** is explicitly documented as optional as of Jul 2026.

### Optional file fields (submit without them must succeed)

- `propertyDocumentPdf` ← **this change**
- `geotagRoofPhoto`
- `customerWithHousePhoto`

Canonical set in code: `OPTIONAL_QUOTATION_DOCUMENT_MEDIA_FIELDS` in `controllers/quotationController.ts`.

---

## Behaviour

```ts
// Do NOT require:
const optionalFiles = new Set([
  'propertyDocumentPdf',
  'geotagRoofPhoto',
  'customerWithHousePhoto',
])
```

- **Partial updates:** omitted key on this request → **keep** existing stored URL.
- **Never uploaded:** stored value stays `null` — valid.
- **Uploaded later:** PDF-only (`application/pdf`); replaces stored reference; next GET / reopen shows View link.
- Empty string / null body values are treated as omitted (no `min(1)` 400).

---

## Endpoints

| Method | Path | Handler |
|--------|------|---------|
| `PATCH` | `/api/quotations/{quotationId}/documents` | `saveQuotationDocuments` |
| `POST` | `/api/quotations/{quotationId}/documents` | same |

Auth: `authorizeQuotationDocumentsEditor` (dealer, admin, AM/HR, baldev/confirmation as configured).

---

## QA

1. Document Submission: required text (+ required images per UI), **skip** Property Documents PDF → **200**.
2. Reopen → Property Documents empty; other files still viewable.
3. Upload Property Documents PDF later → **200**; field persists.
4. No **400** whose `details[]` mention `propertyDocumentPdf` / property document when the PDF is absent.

If a **400** still appears, check `details[]` — usually missing `phoneNumber` / `emailId` / `electricityKno`, not the property PDF.

---

## Related

- `BACKEND_CHANGES_REQUIRED.md` — Quotation customer documents PATCH
- `BACKEND_CHANGES_HANDOFF.md` — **§18**
- Frontend: `lib/quotation-documents-form.ts` (sends the file **when present**)
