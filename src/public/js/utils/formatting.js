/**
 * Formatting utility functions
 * Handles display formatting for distances, areas, ages, and text
 */

/**
 * Format distance for display
 * @param {number} meters - Distance in meters
 * @returns {string} Formatted distance string (e.g., "150m", "1.2km", "2.5mi")
 */
export function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  } else if (meters < 1609.344) {
    return `${(meters / 1000).toFixed(1)}km`;
  } else {
    const miles = meters / 1609.344;
    return `${miles.toFixed(1)}mi`;
  }
}

/**
 * Format area for display
 * @param {number} squareMeters - Area in square meters
 * @returns {string} Formatted area string (e.g., "500m²", "1.5ha", "2.3ac")
 */
export function formatArea(squareMeters) {
  if (squareMeters < 10000) {
    return `${Math.round(squareMeters)}m²`;
  } else if (squareMeters < 2589988.11) {
    return `${(squareMeters / 10000).toFixed(1)}ha`;
  } else {
    const acres = squareMeters / 4046.86;
    return `${acres.toFixed(1)}ac`;
  }
}

/**
 * Format age/timestamp as relative time (e.g., "1d 2h 3m ago", "45m 10s ago")
 * @param {number|string|Date} timestamp - Timestamp (milliseconds, ISO string, or Date object)
 * @returns {string} Formatted age string
 */
export function formatAge(timestamp) {
  const now = Date.now();
  let timestampMs = 0;
  if (typeof timestamp === 'number') {
    timestampMs = timestamp;
  } else if (timestamp instanceof Date) {
    timestampMs = timestamp.getTime();
  } else if (typeof timestamp === 'string') {
    // Numeric strings (e.g. from data-timestamp) are milliseconds; parse as number so they're not misinterpreted by Date()
    const num = Number(timestamp);
    timestampMs = Number.isFinite(num) ? num : new Date(timestamp).getTime();
  }
  
  const ageMs = now - timestampMs;
  
  if (ageMs < 0) return 'Just now';
  
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  const parts = [];
  
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours % 24 > 0) {
    parts.push(`${hours % 24}h`);
  }
  if (minutes % 60 > 0) {
    parts.push(`${minutes % 60}m`);
  }
  if (seconds % 60 > 0 && days === 0 && hours === 0) {
    parts.push(`${seconds % 60}s`);
  }
  
  if (parts.length === 0) {
    return 'Just now';
  }
  
  return parts.join(' ') + ' ago';
}

/**
 * Capitalize first letter of a string
 * @param {string} str - String to capitalize
 * @returns {string} String with first letter capitalized
 */
export function capitalizeFirst(str) {
  if (!str || typeof str !== 'string') return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} HTML-escaped text
 */
export function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Get status description from status code
 * @param {string} status - Status code
 * @returns {string} Human-readable status description
 */
export function getStatusDescription(status) {
  const statusMap = {
    'sending': 'Sending...',
    'sent': 'Sent',
    'delivered': 'Delivered',
    'failed': 'Failed',
    'retrying': 'Retrying...'
  };
  return statusMap[status?.toLowerCase()] || status || 'Unknown';
}
