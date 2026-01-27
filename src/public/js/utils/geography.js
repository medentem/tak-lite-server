/**
 * Geographic utility functions
 * Handles coordinate calculations, distance measurements, and geographic transformations
 */

/**
 * Convert degrees to radians
 * @param {number} degrees - Angle in degrees
 * @returns {number} Angle in radians
 */
export function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 * @param {number} radians - Angle in radians
 * @returns {number} Angle in degrees
 */
export function toDegrees(radians) {
  return radians * (180 / Math.PI);
}

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in meters
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate distance between two coordinate objects
 * @param {{lat: number, lng: number}|{lt: number, lng: number}} point1 - First point
 * @param {{lat: number, lng: number}|{lt: number, lng: number}} point2 - Second point
 * @returns {number} Distance in meters
 */
export function calculateDistance(point1, point2) {
  const lat1 = point1.lat ?? point1.lt;
  const lng1 = point1.lng;
  const lat2 = point2.lat ?? point2.lt;
  const lng2 = point2.lng;
  
  return haversineDistance(lat1, lng1, lat2, lng2);
}

/**
 * Extract coordinates from various coordinate object formats
 * Handles Android format: {lt, lng}, Server format: {lat, lng}, Location format: {latitude, longitude}
 * @param {Object} coordObj - Coordinate object in any supported format
 * @returns {[number, number]|null} [longitude, latitude] array or null if invalid
 */
export function extractCoordinates(coordObj) {
  if (!coordObj) return null;
  
  // Handle different coordinate formats:
  // Android format: { lt: number, lng: number }
  // Server format: { lat: number, lng: number }
  // Location format: { latitude: number, longitude: number }
  const lat = coordObj.lat ?? coordObj.lt ?? coordObj.latitude;
  const lng = coordObj.lng ?? coordObj.longitude;
  
  // Validate coordinates
  if (typeof lng === 'number' && typeof lat === 'number' && 
      !isNaN(lng) && !isNaN(lat) && 
      isFinite(lng) && isFinite(lat) &&
      lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
    return [lng, lat];
  }
  return null;
}

/**
 * Validate coordinate values
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 * @returns {boolean} True if coordinates are valid
 */
export function isValidCoordinate(lng, lat) {
  return typeof lng === 'number' && typeof lat === 'number' && 
         !isNaN(lng) && !isNaN(lat) && 
         isFinite(lng) && isFinite(lat) &&
         lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

/**
 * Generate circle polygon points using geographic calculations
 * @param {number} centerLng - Center longitude
 * @param {number} centerLat - Center latitude
 * @param {number} radiusMeters - Radius in meters
 * @param {number} numPoints - Number of points to generate (default: 32)
 * @returns {Array<[number, number]>} Array of [lng, lat] coordinate pairs
 */
export function generateCirclePolygon(centerLng, centerLat, radiusMeters, numPoints = 32) {
  const points = [];
  const earthRadius = 6371000; // meters
  const angularDistance = radiusMeters / earthRadius;
  const centerLatRad = toRadians(centerLat);
  const centerLonRad = toRadians(centerLng);

  for (let i = 0; i < numPoints; i++) {
    const bearingRad = toRadians((i * 360.0 / numPoints));
    const latRad = Math.asin(Math.sin(centerLatRad) * Math.cos(angularDistance) + 
                            Math.cos(centerLatRad) * Math.sin(angularDistance) * Math.cos(bearingRad));
    const lonRad = centerLonRad + Math.atan2(Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(centerLatRad), 
                                             Math.cos(angularDistance) - Math.sin(centerLatRad) * Math.sin(latRad));
    points.push([toDegrees(lonRad), toDegrees(latRad)]);
  }
  points.push(points[0]); // Close the polygon
  return points;
}

/**
 * Convert pixels to meters at current zoom level and latitude
 * @param {number} pixels - Pixel distance
 * @param {number} zoom - Map zoom level
 * @param {number} latitude - Latitude for calculation
 * @returns {number} Distance in meters
 */
export function pixelsToMeters(pixels, zoom, latitude) {
  // Calculate meters per pixel at this zoom level and latitude
  const metersPerPixel = (156543.03392 * Math.cos(latitude * Math.PI / 180)) / Math.pow(2, zoom);
  return pixels * metersPerPixel;
}

/**
 * Calculate line length from array of points
 * @param {Array<{lng: number, lt: number}|{lng: number, lat: number}>} points - Array of coordinate points
 * @returns {number|null} Total length in meters, or null if insufficient points
 */
export function calculateLineLength(points) {
  if (!points || points.length < 2) return null;
  
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const lat1 = p1.lat ?? p1.lt;
    const lng1 = p1.lng;
    const lat2 = p2.lat ?? p2.lt;
    const lng2 = p2.lng;
    totalLength += haversineDistance(lat1, lng1, lat2, lng2);
  }
  
  return totalLength;
}

/**
 * Calculate area of a circle
 * @param {number} radiusMeters - Radius in meters
 * @returns {number} Area in square meters
 */
export function calculateCircleArea(radiusMeters) {
  return Math.PI * radiusMeters * radiusMeters;
}

/**
 * Calculate polygon area using shoelace formula
 * @param {Array<{lng: number, lt: number}|{lng: number, lat: number}>} points - Array of coordinate points
 * @returns {number|null} Area in square meters, or null if insufficient points
 */
export function calculatePolygonArea(points) {
  if (!points || points.length < 3) return null;
  
  // Use the shoelace formula for polygon area
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const p1 = points[i];
    const p2 = points[j];
    area += (p1.lng ?? p1.longitude) * (p2.lat ?? p2.lt ?? p2.latitude);
    area -= (p2.lng ?? p2.longitude) * (p1.lat ?? p1.lt ?? p1.latitude);
  }
  area = Math.abs(area) / 2;
  
  // Convert from square degrees to square meters (approximate)
  // This is a rough approximation - for more accuracy, we'd need proper projection
  const lat = points[0].lat ?? points[0].lt ?? points[0].latitude;
  const metersPerDegreeLat = 111320; // meters per degree latitude
  const metersPerDegreeLng = 111320 * Math.cos(lat * Math.PI / 180); // meters per degree longitude at this latitude
  
  return area * metersPerDegreeLat * metersPerDegreeLng;
}
