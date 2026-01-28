/**
 * Messages page module
 */

import { q } from '../utils/dom.js';
import { websocketService } from '../services/websocket.js';

let messageLog = [];
const MAX_MESSAGE_ITEMS = 100;
let messageTeamFilter = '';
let messageAutoScroll = true;
let messageShowTimestamps = true;

export class MessagesPage {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    
    this.setupControls();
    this.setupWebSocketListeners();
    this.updateMessageDisplay();
    this.initialized = true;
  }

  setupControls() {
    // Team filter (full monitor)
    const teamFilter = q('#message_team_filter');
    if (teamFilter) {
      teamFilter.addEventListener('change', (e) => {
        messageTeamFilter = e.target.value || '';
        this.updateMessageDisplay();
      });
    }

    // Team filter (compact monitor)
    const teamFilterCompact = q('#message_team_filter_compact');
    if (teamFilterCompact) {
      teamFilterCompact.addEventListener('change', () => {
        this.updateMessageDisplay();
      });
    }

    // Clear messages button (full)
    const clearBtn = q('#clear_messages');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearMessages());
    }

    // Clear messages button (compact)
    const clearBtnCompact = q('#clear_messages_compact');
    if (clearBtnCompact) {
      clearBtnCompact.addEventListener('click', () => this.clearMessages());
    }

    // Auto-scroll toggle
    const autoScrollToggle = q('#message_auto_scroll');
    if (autoScrollToggle) {
      autoScrollToggle.addEventListener('change', (e) => {
        messageAutoScroll = e.target.checked;
      });
    }

    // Show timestamps toggle
    const timestampsToggle = q('#message_show_timestamps');
    if (timestampsToggle) {
      timestampsToggle.addEventListener('change', (e) => {
        messageShowTimestamps = e.target.checked;
        this.updateMessageDisplay();
      });
    }

    // View All Messages link
    const viewAllMessages = q('#view-all-messages');
    if (viewAllMessages) {
      viewAllMessages.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'messages' } }));
      });
    }
  }

  setupWebSocketListeners() {
    websocketService.on('message_received', (data) => {
      this.handleMessageReceived(data);
    });
  }

  handleMessageReceived(data) {
    const timestamp = new Date();
    const messageEntry = {
      id: data.id,
      timestamp: timestamp,
      teamId: data.team_id,
      userId: data.user_id,
      userName: data.user_name || 'Unknown User',
      userEmail: data.user_email || 'unknown@example.com',
      content: data.content,
      messageType: data.message_type || 'text'
    };

    messageLog.unshift(messageEntry);
    if (messageLog.length > MAX_MESSAGE_ITEMS) {
      messageLog = messageLog.slice(0, MAX_MESSAGE_ITEMS);
    }

    this.updateMessageDisplay();
  }

  updateMessageDisplay() {
    // Update compact display (old side panel)
    const compactEl = q('#message_monitor_compact');
    this.updateCompactMessageDisplay(compactEl);
    
    // Update HUD panel display
    const hudEl = q('#messages-hud-content');
    this.updateCompactMessageDisplay(hudEl);
    
    // Update full display (messages page)
    const fullEl = q('#message_monitor');
    if (fullEl) {
      this.updateFullMessageDisplay(fullEl);
    }
    
    // Update badge
    const badgeEl = q('#messages-hud-badge');
    const badgeStatusEl = q('#k_recent_messages');
    const messageCount = messageLog.length;
    
    if (badgeEl) {
      badgeEl.textContent = messageCount;
      badgeEl.style.display = messageCount > 0 ? 'inline-block' : 'none';
    }
    
    if (badgeStatusEl) {
      badgeStatusEl.textContent = messageCount;
    }
  }

  updateCompactMessageDisplay(messageEl) {
    if (!messageEl) return;

    if (messageLog.length === 0) {
      messageEl.innerHTML = '<div class="muted" style="text-align: center; padding: 20px; font-size: 12px;">Waiting for messages...</div>';
      return;
    }

    // Filter messages by team if filter is set
    const teamFilter = q('#message_team_filter_compact')?.value || '';
    const filteredMessages = teamFilter
      ? messageLog.filter(msg => msg.teamId === teamFilter)
      : messageLog;

    if (filteredMessages.length === 0) {
      messageEl.innerHTML = '<div class="muted" style="text-align: center; padding: 20px; font-size: 12px;">No messages for selected team...</div>';
      return;
    }

    // Show only last 10 messages in compact view
    const recentMessages = filteredMessages.slice(0, 10);

    const html = recentMessages.map(msg => {
      const timeStr = msg.timestamp.toLocaleTimeString();
      return `<div style="margin-bottom: 6px; line-height: 1.3; font-size: 11px;">
        <span style="color: #3b82f6; font-weight: 500;">[${timeStr}] ${msg.userName}:</span>
        <span style="color: #e6edf3;">${this.escapeHtml(msg.content)}</span>
      </div>`;
    }).join('');

    messageEl.innerHTML = html;

    // Auto-scroll to bottom
    messageEl.scrollTop = messageEl.scrollHeight;
  }

  updateFullMessageDisplay(messageEl) {
    if (!messageEl) return;

    if (messageLog.length === 0) {
      messageEl.innerHTML = '<div class="muted" style="text-align: center; padding: 20px;">Waiting for messages...</div>';
      return;
    }

    // Filter messages by team if filter is set
    const filteredMessages = messageTeamFilter
      ? messageLog.filter(msg => msg.teamId === messageTeamFilter)
      : messageLog;

    if (filteredMessages.length === 0) {
      messageEl.innerHTML = '<div class="muted" style="text-align: center; padding: 20px;">No messages for selected team...</div>';
      return;
    }

    const html = filteredMessages.map(msg => {
      const timeStr = messageShowTimestamps ? msg.timestamp.toLocaleTimeString() : '';
      const timePrefix = timeStr ? `[${timeStr}] ` : '';
      const teamInfo = messageTeamFilter ? '' : ` (Team: ${msg.teamId.substring(0, 8)}...)`;

      return `<div style="margin-bottom: 8px; line-height: 1.4;">
        <span style="color: #3b82f6;">${timePrefix}${msg.userName}${teamInfo}:</span>
        <span style="color: #e6edf3;">${this.escapeHtml(msg.content)}</span>
      </div>`;
    }).join('');

    messageEl.innerHTML = html;

    // Auto-scroll to bottom if enabled
    if (messageAutoScroll) {
      messageEl.scrollTop = messageEl.scrollHeight;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  clearMessages() {
    messageLog = [];
    this.updateMessageDisplay();
  }

  populateTeamFilters(teams) {
    const messageTeamFilter = q('#message_team_filter');
    if (messageTeamFilter) {
      messageTeamFilter.innerHTML = '<option value="">All Teams</option>';
      teams.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        messageTeamFilter.appendChild(o);
      });
    }

    const messageTeamFilterCompact = q('#message_team_filter_compact');
    if (messageTeamFilterCompact) {
      messageTeamFilterCompact.innerHTML = '<option value="">All Teams</option>';
      teams.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        messageTeamFilterCompact.appendChild(o);
      });
    }
  }
}

export const messagesPage = new MessagesPage();
