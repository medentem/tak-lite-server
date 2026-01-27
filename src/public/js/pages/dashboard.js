/**
 * Dashboard page module
 */

import { q, showMessage, showError } from '../utils/dom.js';
import { get } from '../utils/api.js';
import { websocketService } from '../services/websocket.js';

export class DashboardPage {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    
    this.setupWebSocketListeners();
    this.refresh();
    this.initialized = true;
  }

  setupWebSocketListeners() {
    websocketService.on('stats_update', (stats) => {
      this.updateStatsDisplay(stats);
    });

    websocketService.on('connection_update', (data) => {
      this.updateConnectionsDisplay(data);
    });
  }

  async refresh() {
    try {
      const [stats, config] = await Promise.all([
        get('/api/admin/stats'),
        get('/api/admin/config')
      ]);

      this.updateStatsDisplay(stats);
      this.updateConnectionsDisplay(stats.sockets);
      
      // Update version
      if (stats.version) {
        const versionEl = q('#header_version');
        if (versionEl) {
          versionEl.textContent = stats.version.version || '-';
        }
      }
    } catch (error) {
      console.error('Failed to refresh dashboard:', error);
      showError(`Failed to refresh dashboard: ${error.message}`);
    }
  }

  updateStatsDisplay(stats) {
    if (!stats) return;

    // Update KPI values
    const usersEl = q('#k_users');
    if (usersEl) {
      usersEl.textContent = stats.users?.active || stats.users?.total || 0;
    }

    const teamsEl = q('#k_teams');
    if (teamsEl) {
      teamsEl.textContent = stats.teams?.total || 0;
    }

    const syncStatusEl = q('#k_sync_status');
    if (syncStatusEl) {
      const syncStatus = stats.sync?.status || 'unknown';
      syncStatusEl.textContent = syncStatus;
      syncStatusEl.style.color = syncStatus === 'active' ? '#22c55e' : '#8b97a7';
    }
  }

  updateConnectionsDisplay(data) {
    if (!data) return;

    const totalConnections = data.totalConnections || 0;
    const authConnections = data.authenticatedConnections || 0;

    // Update connection stats if elements exist
    // This would update any connection-related displays
  }
}

export const dashboardPage = new DashboardPage();
