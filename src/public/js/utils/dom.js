/**
 * DOM utility functions
 */

/**
 * Query selector shorthand
 * @param {string} selector - CSS selector
 * @returns {Element|null}
 */
export function q(selector) {
  return document.querySelector(selector);
}

/**
 * Query selector all shorthand
 * @param {string} selector - CSS selector
 * @returns {NodeList}
 */
export function qAll(selector) {
  return document.querySelectorAll(selector);
}

/**
 * Show a message to the user
 * @param {string} message - Message text
 * @param {string} type - Message type: 'success', 'error', 'info'
 * @param {HTMLElement|null} container - Optional container element, defaults to #globalMessage
 */
export function showMessage(message, type = 'info', container = null) {
  const messageEl = container || q('#globalMessage');
  if (!messageEl) {
    console.warn('Message container not found');
    return;
  }
  
  messageEl.textContent = message;
  messageEl.className = `message message-${type}`;
  messageEl.classList.remove('hidden');
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    messageEl.classList.add('fade-out');
    setTimeout(() => {
      messageEl.classList.add('hidden');
      messageEl.classList.remove('fade-out');
    }, 300);
  }, 5000);
}

/**
 * Hide message
 * @param {HTMLElement|null} container - Optional container element
 */
export function hideMessage(container = null) {
  const messageEl = container || q('#globalMessage');
  if (messageEl) {
    messageEl.classList.add('hidden');
  }
}

/**
 * Show success message
 * @param {string} message - Message text
 */
export function showSuccess(message) {
  showMessage(message, 'success');
}

/**
 * Show error message
 * @param {string} message - Message text
 */
export function showError(message) {
  showMessage(message, 'error');
}

/**
 * Show info message
 * @param {string} message - Message text
 */
export function showInfo(message) {
  showMessage(message, 'info');
}

/**
 * Set loading state on an element
 * @param {HTMLElement} element - Element to set loading state on
 * @param {boolean} isLoading - Whether element is loading
 */
export function setLoading(element, isLoading) {
  if (!element) return;
  
  if (isLoading) {
    element.classList.add('loading');
    element.disabled = true;
  } else {
    element.classList.remove('loading');
    element.disabled = false;
  }
}

/**
 * Toggle visibility of an element
 * @param {HTMLElement|string} element - Element or selector
 * @param {boolean} visible - Whether to show or hide
 */
export function toggleVisibility(element, visible) {
  const el = typeof element === 'string' ? q(element) : element;
  if (!el) return;
  
  if (visible) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

/**
 * Wait for element to be available in DOM
 * @param {string} selector - CSS selector
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Element>}
 */
export function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const element = q(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver(() => {
      const element = q(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}
