/**
 * Main entry point for admin interface
 */

import { Navigation } from './components/Navigation.js';
import { auth } from './auth.js';
import { dashboardPage } from './pages/dashboard.js';
import { settingsPage } from './pages/settings.js';
import { managementPage } from './pages/management.js';
import { threatsPage } from './pages/threats.js';
import { messagesPage } from './pages/messages.js';
import { websocketService } from './services/websocket.js';
import { q, showMessage } from './utils/dom.js';

class AdminApp {
  constructor() {
    this.navigation = null;
    this.currentPage = 'dashboard';
    this.pages = {
      dashboard: dashboardPage,
      settings: settingsPage,
      management: managementPage,
      threats: threatsPage,
      messages: messagesPage
    };
  }

  async init() {
    try {
      // Load version immediately (works even when not authenticated)
      if (this.pages.dashboard.updateVersion) {
        this.pages.dashboard.updateVersion().catch(console.error);
      }

      // Check authentication
      const isAuthenticated = await auth.checkExistingAuth();
      
      if (isAuthenticated) {
        this.setupAuthenticatedApp(auth.isAdmin);
      } else {
        // Wait for login
        document.addEventListener('authChanged', (e) => {
          if (e.detail.authenticated) {
            this.setupAuthenticatedApp(auth.isAdmin);
          }
        });
      }

      // Setup page change listener
      document.addEventListener('pageChanged', (e) => {
        this.handlePageChange(e.detail.page);
      });

      // Setup navigation listener
      document.addEventListener('navigate', (e) => {
        if (this.navigation) {
          this.navigation.navigate(e.detail.page);
        }
      });
    } catch (error) {
      console.error('Failed to initialize admin app:', error);
      // Show error to user
      const errorMsg = q('#globalMessage') || document.body;
      if (errorMsg) {
        errorMsg.innerHTML = `<div class="message message-error">Failed to load application. Please refresh the page.</div>`;
      }
    }
  }

  setupAuthenticatedApp(isAdmin = true) {
    try {
      // Initialize navigation (non-admins only see dashboard)
      this.navigation = new Navigation(isAdmin);

      // Connect WebSocket (only after auth is confirmed)
      if (typeof io !== 'undefined') {
        websocketService.connect().catch(err => {
          console.warn('WebSocket connection failed:', err);
          // Non-critical, continue without WebSocket
        });
      } else {
        // Wait for Socket.IO to load
        const checkSocketIO = setInterval(() => {
          if (typeof io !== 'undefined') {
            clearInterval(checkSocketIO);
            websocketService.connect().catch(console.warn);
          }
        }, 100);
        
        // Timeout after 5 seconds
        setTimeout(() => clearInterval(checkSocketIO), 5000);
      }

      // Initialize pages (non-admins only get dashboard to avoid 403s on admin-only API calls)
      const pagesToInit = isAdmin
        ? Object.values(this.pages)
        : [this.pages.dashboard];
      pagesToInit.forEach(page => {
        try {
          if (page && page.init) {
            page.init();
          }
        } catch (error) {
          console.error('Failed to initialize page:', error);
        }
      });

      // Show dashboard by default
      this.handlePageChange('dashboard');

      // Refresh dashboard data
      if (this.pages.dashboard.refresh) {
        this.pages.dashboard.refresh().catch(console.error);
      }

      showMessage('Welcome back!', 'success');
    } catch (error) {
      console.error('Failed to setup authenticated app:', error);
      showMessage('Some features may not be available', 'warning');
    }
  }

  handlePageChange(page) {
    this.currentPage = page;

    // Initialize the page if needed
    const pageInstance = this.pages[page];
    if (pageInstance && pageInstance.init && !pageInstance.initialized) {
      try {
        pageInstance.init();
      } catch (error) {
        console.error(`Failed to initialize ${page} page:`, error);
      }
    }

    // Load page-specific data
    if (page === 'dashboard' && this.pages.dashboard.refresh) {
      this.pages.dashboard.refresh().catch(console.error);
    } else if (page === 'threats' && this.pages.threats.loadThreats) {
      this.pages.threats.loadThreats().catch(console.error);
    }
  }
}

// Initialize app when DOM is ready
function initApp() {
  try {
    new AdminApp().init();
  } catch (error) {
    console.error('Critical error initializing app:', error);
    document.body.innerHTML = '<div style="padding: 20px; color: #ef4444;">Failed to load application. Please refresh the page.</div>';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  // DOM is already ready
  initApp();
}
