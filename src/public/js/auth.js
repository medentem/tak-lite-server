/**
 * Authentication module
 */

import { q, showMessage, showError, showSuccess, setLoading, toggleVisibility } from './utils/dom.js';
import { getToken, setToken, removeToken } from './utils/storage.js';
import { post } from './utils/api.js';
import { websocketService } from './services/websocket.js';

let currentToken = getToken() || '';

export class Auth {
  constructor() {
    this.isAuthenticated = false;
    this.isAdmin = false;
  }

  async checkExistingAuth() {
    try {
      // First check localStorage token
      const storedToken = getToken();
      if (storedToken) {
        currentToken = storedToken;
        const isValid = await this.validateToken(storedToken);
        if (isValid) {
          this.setAuthenticated(true);
          return true;
        }
      }

      // Try cookies
      const res = await fetch('/api/auth/whoami', {
        method: 'GET',
        credentials: 'include'
      });

      if (res.ok) {
        const userData = await res.json();
        this.isAdmin = !!userData.isAdmin;
        this.setAuthenticated(true, userData.name ?? userData.email);
        return true;
      }
    } catch (e) {
      console.log('No existing authentication found');
    }

    this.setAuthenticated(false);
    this.isAdmin = false;
    return false;
  }

  async validateToken(token) {
    try {
      const res = await fetch('/api/auth/whoami', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const userData = await res.json();
        this.isAdmin = !!userData.isAdmin;
        this.setAuthenticated(true, userData.name ?? userData.email);
        return true;
      } else {
        removeToken();
        currentToken = '';
        return false;
      }
    } catch (e) {
      removeToken();
      currentToken = '';
      this.isAdmin = false;
      return false;
    }
  }

  async login(username, password) {
    try {
      setLoading(true);
      
      if (!username || !password) {
        showError('Please enter both username and password');
        return false;
      }

      const data = await post('/api/auth/login?cookie=1', { username, password });
      
      currentToken = data.token;
      setToken(data.token);
      // Fetch whoami so we have isAdmin for the dashboard
      try {
        const whoRes = await fetch('/api/auth/whoami', {
          method: 'GET',
          credentials: 'include',
          headers: { 'Authorization': `Bearer ${data.token}` }
        });
        if (whoRes.ok) {
          const userData = await whoRes.json();
          this.isAdmin = !!userData.isAdmin;
        }
      } catch (_) {
        this.isAdmin = false;
      }
      this.setAuthenticated(true, username);
      
      showSuccess('Login successful!');
      
      // If we're on the login page, redirect to admin dashboard
      if (window.location.pathname === '/login') {
        window.location.href = '/admin';
        return true;
      }
      
      return true;
    } catch (error) {
      showError(error.message || 'Login failed. Please check your credentials.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  async logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (e) {
      console.error('Logout error:', e);
    }

    currentToken = '';
    removeToken();
    websocketService.disconnect();
    this.setAuthenticated(false);
    showMessage('Logged out successfully', 'info');
  }

  setAuthenticated(authenticated, displayName = null) {
    this.isAuthenticated = authenticated;
    if (!authenticated) this.isAdmin = false;

    const loginCard = q('#loginCard');
    const logoutBtn = q('#logout');
    const whoSpan = q('#who');
    const adminNav = q('#adminNav');

    toggleVisibility(loginCard, !authenticated);
    toggleVisibility(logoutBtn, authenticated);
    toggleVisibility(whoSpan, authenticated);
    toggleVisibility(adminNav, authenticated);
    if (!authenticated) {
      document.body.classList.remove('admin-page-visible', 'dashboard-visible');
    }

    if (whoSpan && displayName) {
      whoSpan.textContent = displayName;
    }

    // Dispatch event
    document.dispatchEvent(new CustomEvent('authChanged', {
      detail: { authenticated, displayName }
    }));
  }

  getToken() {
    return currentToken;
  }
}

export const auth = new Auth();

// Setup login button
if (q('#login')) {
  q('#login').addEventListener('click', async () => {
    const username = q('#username')?.value.trim();
    const password = q('#password')?.value;
    await auth.login(username, password);
  });
}

// Setup logout button
if (q('#logout')) {
  q('#logout').addEventListener('click', () => auth.logout());
}
