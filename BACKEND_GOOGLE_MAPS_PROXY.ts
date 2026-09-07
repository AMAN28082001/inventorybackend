// @ts-nocheck
/**
 * =============================================================================
 * BACKEND — Google Maps proxy (geotag Live photo) — Aug 2026
 * =============================================================================
 *
 * UI: Installation Live photo / Upload geotag stamp (`lib/live-geotag-photo.ts`)
 * Docs: REQUIRED §AK, HANDOFF §38
 *
 * Keep `GOOGLE_MAPS_API_KEY` on the server only. Frontend must call these
 * proxies (Bearer JWT) instead of Google directly (CORS / key / quota).
 *
 * =============================================================================
 */

/**
 * Env:
 *   GOOGLE_MAPS_API_KEY=...          required for both endpoints
 *   MAPS_RATE_LIMIT_WINDOW_MS=60000  optional (default 60s)
 *   MAPS_RATE_LIMIT_MAX=60           optional (default 60 req / window / user|ip)
 */

/**
 * GET /api/maps/reverse-geocode?lat=26.91&lng=75.78
 * Auth: Bearer (inventory or quotation JWT)
 *
 * {
 *   "success": true,
 *   "data": {
 *     "title": "Jaipur, Rajasthan, India",
 *     "address": "…",
 *     "countryCode": "IN",
 *     "lat": 26.91,
 *     "lng": 75.78
 *   }
 * }
 */

/**
 * GET /api/maps/static?lat=26.91&lng=75.78&zoom=18&size=640x640&scale=2&maptype=hybrid
 * Auth: Bearer
 * Response: image/png (or image/*) — stream, not JSON
 */

/**
 * Optional follow-up (see BACKEND_INSTALLATION_LIVE_GEOTAG.ts / §AJ):
 * Persist installationImageCaptureMetaJson on completion upload
 * (lat, lng, address, capturedAt, source).
 */

export const GOOGLE_MAPS_PROXY_PATHS = {
  reverseGeocode: '/api/maps/reverse-geocode',
  staticMap: '/api/maps/static',
};
