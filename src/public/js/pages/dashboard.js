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

    // Mobile: activity sheet (pills + bottom sheet)
    this.setupMobileActivitySheet();
    
    // Refresh data
    this.refresh();
    this.initialized = true;
  }

  setupMobileActivitySheet() {
    const sheet = q('#mobileActivitySheet');
    const overlay = q('#mobileActivitySheetOverlay');
    const pillThreats = q('#mobile-pill-threats');
    const pillMessages = q('#mobile-pill-messages');
    const closeBtn = q('#mobile-activity-sheet-close');
    const tabThreats = q('#mobile-sheet-tab-threats');
    const tabMessages = q('#mobile-sheet-tab-messages');
    const paneThreats = q('#mobile-sheet-threats-wrap');
    const paneMessages = q('#mobile-sheet-messages-wrap');
    const viewAllThreats = q('#mobile-sheet-view-all-threats');
    const viewAllMessages = q('#mobile-sheet-view-all-messages');
    const threatsContent = q('#threats-hud-content');
    const messagesContent = q('#messages-hud-content');
    const threatsPanel = q('#threats-hud-panel');
    const messagesPanel = q('#messages-hud-panel');
    const threatsSlot = q('#mobile-sheet-threats-slot');
    const messagesSlot = q('#mobile-sheet-messages-slot');

    if (!sheet || !threatsContent || !messagesContent || !threatsPanel || !messagesPanel) return;

    const openSheet = (tab) => {
      // Return the other pane’s content to its panel before showing the active one
      if (threatsContent.parentElement === threatsSlot) {
        threatsPanel.appendChild(threatsContent);
      }
      if (messagesContent.parentElement === messagesSlot) {
        messagesPanel.appendChild(messagesContent);
      }
      if (tab === 'threats') {
        threatsSlot.appendChild(threatsContent);
        paneThreats.classList.remove('hidden');
        paneMessages.classList.add('hidden');
        tabThreats.classList.add('active');
        tabMessages.classList.remove('active');
      } else {
        messagesSlot.appendChild(messagesContent);
        paneThreats.classList.add('hidden');
        paneMessages.classList.remove('hidden');
        tabThreats.classList.remove('active');
        tabMessages.classList.add('active');
      }
      sheet.classList.remove('hidden');
      sheet.classList.add('open');
      sheet.setAttribute('aria-hidden', 'false');
      if (overlay) {
        overlay.classList.remove('hidden');
        overlay.classList.add('open');
      }
    };

    const closeSheet = () => {
      threatsPanel.appendChild(threatsContent);
      messagesPanel.appendChild(messagesContent);
      sheet.classList.add('hidden');
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden', 'true');
      if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('open');
      }
    };

    if (pillThreats) {
      pillThreats.addEventListener('click', () => openSheet('threats'));
    }
    if (pillMessages) {
      pillMessages.addEventListener('click', () => openSheet('messages'));
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', closeSheet);
    }
    if (overlay) {
      overlay.addEventListener('click', closeSheet);
    }
    if (tabThreats) {
      tabThreats.addEventListener('click', () => openSheet('threats'));
    }
    if (tabMessages) {
      tabMessages.addEventListener('click', () => openSheet('messages'));
    }
    if (viewAllThreats) {
      viewAllThreats.addEventListener('click', (e) => {
        e.preventDefault();
        closeSheet();
        document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'threats' } }));
      });
    }
    if (viewAllMessages) {
      viewAllMessages.addEventListener('click', (e) => {
        e.preventDefault();
        closeSheet();
        document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'messages' } }));
      });
    }
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
      },
      onLocationSearch: (query) => {
        if (window.adminMap && typeof window.adminMap.runLocationSearchWithQuery === 'function') {
          window.adminMap.runLocationSearchWithQuery(query);
        }
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

    // API/socket stats use { db: { users, teams, ... }, sockets: { authenticatedConnections, ... } }
    const db = stats.db || {};
    const sockets = stats.sockets || {};

    // Update KPI values: Users = connected (authenticated) count; Teams = total in DB
    const usersEl = q('#k_users');
    if (usersEl) {
      const connected = sockets.authenticatedConnections;
      const total = db.users;
      usersEl.textContent = connected !== undefined ? connected : (stats.users?.active ?? stats.users?.total ?? total ?? 0);
    }

    const teamsEl = q('#k_teams');
    if (teamsEl) {
      teamsEl.textContent = db.teams ?? stats.teams?.total ?? 0;
    }

    const syncStatusEl = q('#k_sync_status');
    if (syncStatusEl) {
      const syncStatus = stats.sync?.status || 'unknown';
      syncStatusEl.textContent = syncStatus;
      syncStatusEl.style.color = syncStatus === 'active' ? '#22c55e' : '#8b97a7';
    }

    // Sync mobile drawer status
    const drawerUsers = q('#drawer-k-users');
    if (drawerUsers) {
      const connected = sockets.authenticatedConnections;
      const total = db.users;
      drawerUsers.textContent = connected !== undefined ? connected : (stats.users?.active ?? stats.users?.total ?? total ?? 0);
    }
    const drawerTeams = q('#drawer-k-teams');
    if (drawerTeams) drawerTeams.textContent = db.teams ?? stats.teams?.total ?? 0;
    const drawerSync = q('#drawer-k-sync');
    if (drawerSync) drawerSync.textContent = stats.sync?.status || 'unknown';

    // Update threat badge
    const threatCount = stats.threats?.active || 0;
    const threatBadge = q('#k_active_threats');
    if (threatBadge) threatBadge.textContent = threatCount;
    if (this.threatsPanel) this.threatsPanel.updateBadge(threatCount);
    const mobilePillThreatsCount = q('#mobile-pill-threats-count');
    if (mobilePillThreatsCount) mobilePillThreatsCount.textContent = threatCount;

    // Update message badge
    const messageCount = stats.messages?.recent || 0;
    const messageBadge = q('#k_recent_messages');
    if (messageBadge) messageBadge.textContent = messageCount;
    if (this.messagesPanel) this.messagesPanel.updateBadge(messageCount);
    const mobilePillMessagesCount = q('#mobile-pill-messages-count');
    if (mobilePillMessagesCount) mobilePillMessagesCount.textContent = messageCount;
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
