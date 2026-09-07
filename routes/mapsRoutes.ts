import express, { Router } from 'express';
import { authenticateInventoryOrQuotation } from '../middleware/authQuotation';
import { mapsRateLimit } from '../middleware/mapsRateLimit';
import { reverseGeocode, staticMap } from '../controllers/mapsController';

const router: Router = express.Router();

/** All maps proxy routes require a logged-in session (inventory or quotation JWT). */
router.use(authenticateInventoryOrQuotation);
router.use(mapsRateLimit);

/**
 * GET /api/maps/reverse-geocode?lat=&lng=
 * → { success, data: { title, address, countryCode, lat, lng } }
 */
router.get('/reverse-geocode', reverseGeocode);

/**
 * GET /api/maps/static?lat=&lng=&zoom=18&size=640x640&scale=2&maptype=hybrid
 * → image/png (streamed)
 */
router.get('/static', staticMap);

export default router;
