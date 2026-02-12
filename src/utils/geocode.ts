/**
 * Server-side geocoding via Nominatim (OpenStreetMap).
 * Shared by dashboard map address search and threat annotation geolocation so behavior stays consistent.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  display_name?: string | null;
  /** [south, north, west, east] when available (for map fitBounds). */
  bbox?: number[] | null;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'TAK-Lite-Server/1.0 (map search & threat geolocation)';

/**
 * Geocode an address or place name. Uses the same Nominatim request as the dashboard map search.
 * Returns null if no result or on error. Optional bbox is for map fitBounds (e.g. dashboard).
 */
export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed || trimmed.length < 3) return null;

  try {
    const params = new URLSearchParams({
      q: trimmed,
      format: 'json',
      limit: '1',
      addressdetails: '1',
    });
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: {
        'Accept-Language': 'en',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      lat?: string;
      lon?: string;
      display_name?: string;
      boundingbox?: string[];
    }>;
    const first = data?.[0];
    if (!first || first.lat == null || first.lon == null) return null;
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) return null;
    const bbox = Array.isArray(first.boundingbox) && first.boundingbox.length >= 4
      ? first.boundingbox.map((v) => Number(v))
      : null;
    return {
      lat,
      lng,
      display_name: first.display_name ?? null,
      bbox: bbox && bbox.every(Number.isFinite) ? bbox : null,
    };
  } catch {
    return null;
  }
}
