/**
 * Map configuration constants
 * Centralizes all configuration values for the map functionality
 */

/**
 * Map interaction configuration
 */
export const INTERACTION_CONFIG = {
  /** Long press threshold in milliseconds */
  longPressThreshold: 500,
  
  /** Minimum radius for area drawing in pixels */
  minAreaRadiusPixels: 10,
  
  /** Maximum radius for area drawing in pixels */
  maxAreaRadiusPixels: 500,
  
  /** Default radius for area drawing in pixels */
  defaultAreaRadiusPixels: 50,
  
  /** Number of points to generate for circle polygons */
  circlePolygonPoints: 32,

  /** When drawing a line, tap within this many pixels of the start point to close as polygon (matches Android) */
  polygonClosureThresholdPixels: 30
};

/**
 * Map display configuration
 */
export const DISPLAY_CONFIG = {
  /** Staleness threshold in milliseconds (10 minutes) */
  stalenessThresholdMs: 10 * 60 * 1000,
  
  /** Minimum zoom level to show locations */
  minLocationZoomLevel: 7,
  
  /** Default map center (US center) */
  defaultCenter: [-98.5795, 39.8283],
  
  /** Default map zoom level */
  defaultZoom: 4,
  
  /** User location zoom level */
  userLocationZoom: 12,

  /** Zoom level when flying to a single geocoded point (no bbox) — lower = more zoomed out */
  locationSearchZoom: 10,
  
  /** Map fit bounds padding in pixels */
  fitBoundsPadding: 50
};

/**
 * POI icon configuration
 */
export const POI_CONFIG = {
  /** Icon size in pixels */
  iconSize: 32,
  
  /** Icon radius calculation (size / 3) */
  iconRadius: 32 / 3,
  
  /** Icon stroke width */
  strokeWidth: 2,
  
  /** Icon stroke color */
  strokeColor: '#FFFFFF'
};

/**
 * Color definitions (matching Android app)
 */
export const COLORS = {
  green: '#4CAF50',
  yellow: '#FBC02D',
  red: '#F44336',
  black: '#000000',
  white: '#FFFFFF',
  default: '#3b82f6' // Fallback color
};

/**
 * Color name to hex mapping
 * @param {string} color - Color name
 * @returns {string} Hex color code
 */
export function getColorHex(color) {
  return COLORS[color?.toLowerCase()] || COLORS.default;
}

/**
 * API endpoint configuration
 */
export const API_ENDPOINTS = {
  teams: '/api/admin/teams',
  annotations: '/api/admin/map/annotations',
  annotationsById: (id) => `/api/admin/map/annotations/${id}`,
  annotationsBulkDelete: '/api/admin/map/annotations/bulk-delete',
  locations: '/api/admin/map/locations',
  locationsLatest: '/api/admin/map/locations/latest'
};

/**
 * Map layer configuration
 */
export const LAYER_CONFIG = {
  /** Annotation layer IDs */
  annotationLayers: {
    poi: 'annotations-poi',
    line: 'annotations-line',
    area: 'annotations-area',
    areaStroke: 'annotations-area-stroke',
    polygon: 'annotations-polygon',
    polygonStroke: 'annotations-polygon-stroke'
  },
  
  /** Location layer ID */
  locationLayer: 'locations',
  
  /** Temporary drawing layer IDs */
  tempLayers: {
    area: 'temp-area',
    areaFill: 'temp-area-fill',
    areaStroke: 'temp-area-stroke',
    line: 'temp-line',
    lineStroke: 'temp-line-stroke',
    linePoints: 'temp-line-points'
  },
  
  /** Map source IDs */
  sources: {
    annotationsPoi: 'annotations-poi',
    annotationsLine: 'annotations-line',
    annotationsArea: 'annotations-area',
    annotationsPolygon: 'annotations-polygon',
    locations: 'locations',
    tempArea: 'temp-area',
    tempLine: 'temp-line',
    monitorAreas: 'monitor-areas'
  },

  /** Monitor areas layer IDs (geographical social media monitors) */
  monitorAreaLayers: {
    fill: 'monitor-areas-fill',
    stroke: 'monitor-areas-stroke'
  }
};

/**
 * Annotation type definitions
 */
export const ANNOTATION_TYPES = {
  POI: 'poi',
  LINE: 'line',
  AREA: 'area',
  POLYGON: 'polygon'
};

/**
 * POI shape types
 */
export const POI_SHAPES = {
  CIRCLE: 'circle',
  SQUARE: 'square',
  TRIANGLE: 'triangle',
  EXCLAMATION: 'exclamation'
};

/**
 * User status colors (matching Android app)
 */
export const USER_STATUS_COLORS = {
  RED: '#F44336',
  YELLOW: '#FFC107',
  BLUE: '#2196F3',
  ORANGE: '#FF9800',
  VIOLET: '#9C27B0',
  GREEN: '#4CAF50',
  DEFAULT: '#4CAF50'
};

/**
 * Get color for user status
 * @param {string} status - User status
 * @returns {string} Hex color code
 */
export function getUserStatusColor(status) {
  return USER_STATUS_COLORS[status] || USER_STATUS_COLORS.DEFAULT;
}

/**
 * Timing configuration (delays and timeouts)
 */
export const TIMING = {
  /** Library check retry interval */
  libraryCheckInterval: 100,
  
  /** Authentication check interval */
  authCheckInterval: 500,
  
  /** Menu dismiss setup delay */
  menuDismissDelay: 100,

  /** Ignore outside-click dismiss for this long after fan menu opens (avoids dismissing on long-press release) */
  fanMenuOpenGraceMs: 400,
  
  /** Color menu setup delay */
  colorMenuSetupDelay: 50,
  
  /** Context menu setup delay */
  contextMenuSetupDelay: 100,
  
  /** Sync activity refresh delay */
  syncActivityRefreshDelay: 1000,
  
  /** Geolocation timeout */
  geolocationTimeout: 5000,
  
  /** Geolocation maximum age */
  geolocationMaxAge: 300000, // 5 minutes
  
  /** Default feedback duration */
  defaultFeedbackDuration: 3000,
  
  /** Age update interval */
  ageUpdateInterval: 1000
};

/**
 * Data limits
 */
export const DATA_LIMITS = {
  /** Maximum annotations to load */
  maxAnnotations: 1000,
  
  /** Maximum locations to load */
  maxLocations: 100
};
