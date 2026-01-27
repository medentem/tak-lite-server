/**
 * Logging utility with configurable log levels
 * Reduces console noise in production while maintaining debug capability
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

// Determine current log level based on environment
// In production, only show WARN and ERROR
// In development, show all logs
const getCurrentLevel = () => {
  // Check for explicit log level in localStorage (for debugging in production)
  const storedLevel = localStorage.getItem('taklite:logLevel');
  if (storedLevel !== null) {
    return parseInt(storedLevel, 10);
  }
  
  // Default: DEBUG in development, WARN in production
  // We can't easily detect production in client-side JS, so default to INFO
  // Users can set localStorage.setItem('taklite:logLevel', '0') for DEBUG mode
  return LOG_LEVELS.INFO;
};

let currentLevel = getCurrentLevel();

/**
 * Set the log level dynamically
 * @param {number} level - Log level (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR, 4=NONE)
 */
export function setLogLevel(level) {
  currentLevel = level;
  localStorage.setItem('taklite:logLevel', level.toString());
}

/**
 * Get current log level
 * @returns {number} Current log level
 */
export function getLogLevel() {
  return currentLevel;
}

/**
 * Logger object with level-based logging methods
 */
export const logger = {
  /**
   * Debug level logging (most verbose)
   * @param {...any} args - Arguments to log
   */
  debug: (...args) => {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Info level logging (general information)
   * @param {...any} args - Arguments to log
   */
  info: (...args) => {
    if (currentLevel <= LOG_LEVELS.INFO) {
      console.log('[INFO]', ...args);
    }
  },

  /**
   * Warn level logging (warnings)
   * @param {...any} args - Arguments to log
   */
  warn: (...args) => {
    if (currentLevel <= LOG_LEVELS.WARN) {
      console.warn('[WARN]', ...args);
    }
  },

  /**
   * Error level logging (errors only)
   * @param {...any} args - Arguments to log
   */
  error: (...args) => {
    if (currentLevel <= LOG_LEVELS.ERROR) {
      console.error('[ERROR]', ...args);
    }
  },

  /**
   * Log levels enum for reference
   */
  LEVELS: LOG_LEVELS
};
