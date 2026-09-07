import { Request, Response } from 'express';
import { logError, logInfo } from '../utils/loggerHelper';

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeocodeResult = {
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
};

type GoogleGeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: GoogleGeocodeResult[];
};

const normalizePlaceText = (s: string): string =>
  s.toLowerCase().replace(/[,\s]+/g, ' ').trim();

const parseCoord = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
};

const requireGoogleMapsApiKey = (res: Response): string | null => {
  const key = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!key) {
    res.status(503).json({
      success: false,
      error: {
        code: 'MAPS_001',
        message: 'Google Maps is not configured (missing GOOGLE_MAPS_API_KEY).'
      }
    });
    return null;
  }
  return key;
};

const validateLatLng = (
  req: Request,
  res: Response
): { lat: number; lng: number } | null => {
  const lat = parseCoord(req.query.lat ?? req.query.latitude);
  const lng = parseCoord(req.query.lng ?? req.query.longitude ?? req.query.lon);
  if (lat === null || lng === null) {
    res.status(400).json({
      success: false,
      error: { code: 'VAL_001', message: 'lat and lng are required numbers' }
    });
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({
      success: false,
      error: { code: 'VAL_001', message: 'lat/lng out of range' }
    });
    return null;
  }
  return { lat, lng };
};

const pickComponent = (
  components: GoogleAddressComponent[],
  type: string,
  key: 'long_name' | 'short_name' = 'long_name'
): string =>
  String(components.find((c) => (c.types || []).includes(type))?.[key] || '').trim();

/** Normalize Google Geocoding result to FE `GeotagPlace` shape. */
export const normalizeGoogleGeocodeResult = (
  result: GoogleGeocodeResult
): { title: string; address: string; countryCode: string } => {
  const components = result.address_components || [];
  const city =
    pickComponent(components, 'locality') ||
    pickComponent(components, 'administrative_area_level_2');
  const state = pickComponent(components, 'administrative_area_level_1');
  const country = pickComponent(components, 'country');
  const countryCode = pickComponent(components, 'country', 'short_name').toUpperCase();
  const title =
    [city, state, country]
      .filter(Boolean)
      .filter(
        (v, i, arr) =>
          arr.findIndex((x) => normalizePlaceText(String(x)) === normalizePlaceText(String(v))) === i
      )
      .join(', ') || 'Current location';
  const address = String(result.formatted_address || '').trim();
  const addressOut =
    normalizePlaceText(address) === normalizePlaceText(title) ||
    normalizePlaceText(address).includes(normalizePlaceText(title))
      ? ''
      : address;
  return { title, address: addressOut, countryCode };
};

/**
 * GET /api/maps/reverse-geocode?lat=&lng=
 * Proxies Google Geocoding API; returns { title, address, countryCode }.
 */
export const reverseGeocode = async (req: Request, res: Response): Promise<void> => {
  try {
    const apiKey = requireGoogleMapsApiKey(res);
    if (!apiKey) return;
    const coords = validateLatLng(req, res);
    if (!coords) return;

    const latlng = `${coords.lat},${coords.lng}`;
    const language = String(req.query.language || 'en').trim() || 'en';
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${encodeURIComponent(latlng)}` +
      `&language=${encodeURIComponent(language)}` +
      `&key=${encodeURIComponent(apiKey)}`;

    const googleRes = await fetch(url);
    const googleData = (await googleRes.json()) as GoogleGeocodeResponse;

    if (!googleRes.ok || googleData.status !== 'OK' || !googleData.results?.length) {
      const status = googleData.status || `HTTP_${googleRes.status}`;
      logInfo('Google reverse geocode empty/failed', {
        status,
        error: googleData.error_message,
        lat: coords.lat,
        lng: coords.lng,
        userId: req.user?.id
      });
      res.status(status === 'ZERO_RESULTS' ? 404 : 502).json({
        success: false,
        error: {
          code: 'MAPS_002',
          message:
            status === 'ZERO_RESULTS'
              ? 'No address found for these coordinates'
              : `Geocoding failed (${status})`
        }
      });
      return;
    }

    const place = normalizeGoogleGeocodeResult(googleData.results[0]);
    res.json({
      success: true,
      data: {
        ...place,
        lat: coords.lat,
        lng: coords.lng
      }
    });
  } catch (error) {
    logError('Reverse geocode error', error, { userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};

/**
 * GET /api/maps/static?lat=&lng=&zoom=18
 * Proxies Google Static Maps and streams the image (avoids CORS + key exposure).
 */
export const staticMap = async (req: Request, res: Response): Promise<void> => {
  try {
    const apiKey = requireGoogleMapsApiKey(res);
    if (!apiKey) return;
    const coords = validateLatLng(req, res);
    if (!coords) return;

    const zoomRaw = Number(req.query.zoom ?? 18);
    const zoom = Number.isFinite(zoomRaw) ? Math.min(21, Math.max(1, Math.floor(zoomRaw))) : 18;
    const size = String(req.query.size || '640x640').trim() || '640x640';
    if (!/^\d{2,4}x\d{2,4}$/.test(size)) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'size must look like 640x640' }
      });
      return;
    }
    const scaleRaw = Number(req.query.scale ?? 2);
    const scale = scaleRaw === 1 ? 1 : 2;
    const maptype = String(req.query.maptype || 'hybrid').trim() || 'hybrid';
    const allowedMapTypes = new Set(['roadmap', 'satellite', 'terrain', 'hybrid']);
    if (!allowedMapTypes.has(maptype)) {
      res.status(400).json({
        success: false,
        error: { code: 'VAL_001', message: 'Invalid maptype' }
      });
      return;
    }

    const marker = `${coords.lat},${coords.lng}`;
    const url =
      `https://maps.googleapis.com/maps/api/staticmap` +
      `?center=${encodeURIComponent(marker)}` +
      `&zoom=${zoom}` +
      `&size=${encodeURIComponent(size)}` +
      `&scale=${scale}` +
      `&maptype=${encodeURIComponent(maptype)}` +
      `&markers=${encodeURIComponent(`color:red|${marker}`)}` +
      `&key=${encodeURIComponent(apiKey)}`;

    const googleRes = await fetch(url);
    const contentType = googleRes.headers.get('content-type') || '';

    if (!googleRes.ok || contentType.includes('json') || contentType.includes('text')) {
      let detail = '';
      try {
        detail = await googleRes.text();
      } catch {
        detail = '';
      }
      logInfo('Google static map failed', {
        status: googleRes.status,
        contentType,
        detail: detail.slice(0, 300),
        userId: req.user?.id
      });
      res.status(502).json({
        success: false,
        error: { code: 'MAPS_003', message: 'Static map fetch failed' }
      });
      return;
    }

    const buffer = Buffer.from(await googleRes.arrayBuffer());
    res.setHeader('Content-Type', contentType || 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).send(buffer);
  } catch (error) {
    logError('Static map error', error, { userId: req.user?.id });
    res.status(500).json({
      success: false,
      error: { code: 'SYS_001', message: 'Internal server error' }
    });
  }
};
