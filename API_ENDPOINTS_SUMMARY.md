# API Endpoints Summary

Quick reference for frontend integration. Full OpenAPI: `/api-docs`.

---

## Admin — Visitor Reports

### `GET /api/admin/visits`

**Auth:** Bearer admin token (quotation dealer `role=admin` or inventory `admin` / `super-admin` / `super-admin-manager`)

**Fallback:** `GET /api/visits` with quotation admin JWT (same response).

**Query:**

| Param | Example | Notes |
|-------|---------|--------|
| `status` | `all`, `pending`, `approved`, `completed`, … | Default: all statuses |
| `visitorId` | UUID | Filter by assigned visitor |
| `startDate` | `2026-06-01` | `visitDate` ≥ |
| `endDate` | `2026-06-30` | `visitDate` ≤ |
| `search` | `JAGDISH` | Customer, quotation, location, visitor/dealer |
| `page` | `1` | Default 1 |
| `limit` | `2000` | Max 2000 |

**Response:** `{ success, data: { visits[], pagination } }`

Each visit: `id`, `quotationId`, `dealerId`, `visitDate`, `visitTime`, `location`, `status`, `visitors[]` (`visitorName`), `customer` (`firstName`, `lastName`), `dealer`, `rejectionReason`, `notes`. **No images by default** — use `?includeMedia=true` or Details modal.

### `GET /api/quotations/{quotationId}/visits` (Details modal)

Full completion: `notes`, dimensions, `backLegFeet`/`midLegFeet`/`frontLegFeet`, `unit`, presigned `images` / `rowDiagramImage` / `meterImage`, `visitors[].visitorName`, `customer`.

**Spec:** `BACKEND_CHANGES_REQUIRED.md` §Z.11, `BACKEND_CHANGES_HANDOFF.md` §19.
