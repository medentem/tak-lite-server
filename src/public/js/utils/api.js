/**
 * API utility functions
 */

import { getToken, removeToken } from './storage.js';
import { showError } from './dom.js';

/**
 * Make an API call
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise<*>}
 */
export async function apiCall(endpoint, options = {}) {
  const token = getToken();
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers
    }
  };
  
  try {
    const response = await fetch(endpoint, {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...options.headers
      }
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        // Token expired or invalid, redirect to login
        removeToken();
        window.location.href = '/login';
        return;
      }
      
      // Try to parse error response as JSON, fallback to text or status code
      let errorMessage = `HTTP ${response.status}`;
      try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
        } else {
          const text = await response.text();
          errorMessage = text || errorMessage;
        }
      } catch (parseError) {
        // If parsing fails, use status code
        errorMessage = `HTTP ${response.status}: ${response.statusText || 'Unknown error'}`;
      }
      
      throw new Error(errorMessage);
    }
    
    // Parse response as JSON
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    } else {
      // If not JSON, return text or empty object
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

/**
 * GET request
 * @param {string} endpoint - API endpoint
 * @returns {Promise<*>}
 */
export async function get(endpoint) {
  return apiCall(endpoint, { method: 'GET' });
}

/**
 * POST request
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request body
 * @returns {Promise<*>}
 */
export async function post(endpoint, data) {
  return apiCall(endpoint, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

/**
 * PUT request
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request body
 * @returns {Promise<*>}
 */
export async function put(endpoint, data) {
  return apiCall(endpoint, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

/**
 * DELETE request
 * @param {string} endpoint - API endpoint
 * @returns {Promise<*>}
 */
export async function del(endpoint) {
  return apiCall(endpoint, { method: 'DELETE' });
}

/**
 * PATCH request
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request body
 * @returns {Promise<*>}
 */
export async function patch(endpoint, data) {
  return apiCall(endpoint, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}
