/**
 * Dashboard page module
 */

import { q, showMessage, showError } from '../utils/dom.js';
import { get } from '../utils/api.js';
import { websocketService } from '../services/websocket.js';
import { HUDPanel } from '../components/HUDPanel.js';
import { CommandPalette } from '../components/CommandPalette.js';

export class DashboardPage {
  constructor() {
    this.initialized = false;
    this.threatsPanel = null;
    this.messagesPanel = null;
    this.commandPalette = null;
  }

  init() {
    if (this.initialized) return;
    
    // Initialize HUD panels
    this.initHUDPanels();
    
    // Initialize command palette
    this.initCommandPalette();
    
    // Setup WebSocket listeners
    this.setupWebSocketListeners();
    
    // Setup click handlers for status badges
    this.setupStatusBadges();
    
    // Refresh data
    this.refresh();
    this.initialized = true;
  }

  initHUDPanels() {
    // Initialize threats panel
    this.threatsPanel = new HUDPanel('threats-hud-panel', {
      onPin: () => console.log('Threats panel pinned'),
      onUnpin: () => console.log('Threats panel unpinned')
    });

    // Initialize messages panel
    this.messagesPanel = new HUDPanel('messages-hud-panel', {
      onPin: () => console.log('Messages panel pinned'),
      onUnpin: () => console.log('Messages panel unpinned')
    });
  }

  initCommandPalette() {
    this.commandPalette = new CommandPalette({
      onCommandSelect: (command) => {
        console.log('Command selected:', command.id);
      }
    });
  }

  setupStatusBadges() {
    const threatsBadge = q('#threats-badge');
    const messagesBadge = q('#messages-badge');
    
    if (threatsBadge) {
      threatsBadge.addEventListener('click', () => {
        // Toggle threats panel or navigate to threats page
        if (this.threatsPanel) {
          const panel = q('#threats-hud-panel');
          if (panel) {
            panel.style.opacity = panel.style.opacity === '0.85' ? '0.2' : '0.85';
          }
        }
      });
    }
    
    if (messagesBadge) {
      messagesBadge.addEventListener('click', () => {
        // Toggle messages panel or navigate to messages page
        if (this.messagesPanel) {
          const panel = q('#messages-hud-panel');
          if (panel) {
            panel.style.opacity = panel.style.opacity === '0.85' ? '0.2' : '0.85';
          }
        }
      });
    }
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
      
      // Update version in header
      this.updateVersion();
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

    // Update threat badge
    const threatBadge = q('#k_active_threats');
    if (threatBadge) {
      const threatCount = stats.threats?.active || 0;
      threatBadge.textContent = threatCount;
      if (this.threatsPanel) {
        this.threatsPanel.updateBadge(threatCount);
      }
    }

    // Update message badge
    const messageBadge = q('#k_recent_messages');
    if (messageBadge) {
      const messageCount = stats.messages?.recent || 0;
      messageBadge.textContent = messageCount;
      if (this.messagesPanel) {
        this.messagesPanel.updateBadge(messageCount);
      }
    }
  }

  updateConnectionsDisplay(data) {
    if (!data) return;

    const totalConnections = data.totalConnections || 0;
    const authConnections = data.authenticatedConnections || 0;

    // Update connection stats if elements exist
    // This would update any connection-related displays
  }

  async updateVersion() {
    try {
      const versionData = await get('/api/admin/version');
      if (versionData?.version) {
        const versionEl = q('#header_version');
        if (versionEl) {
          versionEl.textContent = `v${versionData.version}`;
          return;
        }
      }
    } catch (error) {
      console.warn('Failed to load version:', error);
      // Set default if version endpoint fails
      const versionEl = q('#header_version');
      if (versionEl && versionEl.textContent === '-') {
        versionEl.textContent = 'v1.0.2';
      }
    }
  }
}

export const dashboardPage = new DashboardPage();
