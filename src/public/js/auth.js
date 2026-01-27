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
        this.setAuthenticated(true, userData.email);
        return true;
      }
    } catch (e) {
      console.log('No existing authentication found');
    }

    this.setAuthenticated(false);
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
        this.setAuthenticated(true, userData.email);
        return true;
      } else {
        removeToken();
        currentToken = '';
        return false;
      }
    } catch (e) {
      removeToken();
      currentToken = '';
      return false;
    }
  }

  async login(email, password) {
    try {
      setLoading(true);
      
      if (!email || !password) {
        showError('Please enter both email and password');
        return false;
      }

      const data = await post('/api/auth/login?cookie=1', { email, password });
      
      currentToken = data.token;
      setToken(data.token);
      this.setAuthenticated(true, email);
      
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

  setAuthenticated(authenticated, email = null) {
    this.isAuthenticated = authenticated;
    
    const loginCard = q('#loginCard');
    const logoutBtn = q('#logout');
    const whoSpan = q('#who');
    const adminNav = q('#adminNav');

    toggleVisibility(loginCard, !authenticated);
    toggleVisibility(logoutBtn, authenticated);
    toggleVisibility(whoSpan, authenticated);
    toggleVisibility(adminNav, authenticated);

    if (whoSpan && email) {
      whoSpan.textContent = email;
    }

    // Dispatch event
    document.dispatchEvent(new CustomEvent('authChanged', {
      detail: { authenticated, email }
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
    const email = q('#email')?.value.trim();
    const password = q('#password')?.value;
    await auth.login(email, password);
  });
}

// Setup logout button
if (q('#logout')) {
  q('#logout').addEventListener('click', () => auth.logout());
}
