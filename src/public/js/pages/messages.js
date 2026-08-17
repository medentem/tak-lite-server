/**
 * Messages page module
 */

import { q } from '../utils/dom.js';
import { post } from '../utils/api.js';
import { websocketService } from '../services/websocket.js';

const MAX_CONTENT_LENGTH = 2000;
let messageLog = [];
const MAX_MESSAGE_ITEMS = 100;
let messageTeamFilter = '';
let messageAutoScroll = true;
let messageShowTimestamps = true;
let sending = false;

export class MessagesPage {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    
    this.setupControls();
    this.setupCompose();
    this.setupWebSocketListeners();
    this.updateMessageDisplay();
    this.syncTeamFiltersFromMap();
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

    // View All Messages link – navigate to Messages page
    const viewAllMessages = q('#view-all-messages');
    if (viewAllMessages) {
      viewAllMessages.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'messages' } }));
      });
    }
  }

  setupCompose() {
    this.bindComposer('#messages-hud-input', '#messages-hud-send');
    this.bindComposer('#messages-page-input', '#messages-page-send');

    const mapTeamSelect = q('#map_team_select');
    if (mapTeamSelect) {
      mapTeamSelect.addEventListener('change', () => this.updateComposeState());
    }

    document.addEventListener('teamsLoaded', (e) => {
      this.populateTeamFilters(e.detail?.teams || []);
      this.updateComposeState();
    });

    this.updateComposeState();
  }

  bindComposer(inputSelector, sendSelector) {
    const input = q(inputSelector);
    const sendBtn = q(sendSelector);
    if (!input || !sendBtn) return;

    sendBtn.addEventListener('click', () => this.sendFromInput(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendFromInput(input);
      }
    });
    input.addEventListener('input', () => this.updateComposeState());
  }

  getSelectedTeam() {
    const mapTeamSelect = q('#map_team_select');
    const teamId = mapTeamSelect?.value || '';
    const teamName = teamId
      ? (mapTeamSelect.options[mapTeamSelect.selectedIndex]?.textContent || 'selected team')
      : '';
    return { teamId, teamName };
  }

  updateComposeState() {
    const { teamId, teamName } = this.getSelectedTeam();
    const hints = [q('#messages-hud-compose-hint'), q('#messages-page-compose-hint')].filter(Boolean);
    const hasTeam = Boolean(teamId);
    const hintText = hasTeam
      ? `Sending to ${teamName}`
      : 'Sending to all teams';

    hints.forEach((hint) => {
      hint.textContent = hintText;
      hint.classList.remove('is-error');
    });

    const pairs = [
      { input: q('#messages-hud-input'), btn: q('#messages-hud-send') },
      { input: q('#messages-page-input'), btn: q('#messages-page-send') },
    ];
    pairs.forEach(({ input, btn }) => {
      if (!input || !btn) return;
      input.disabled = sending;
      btn.disabled = sending || !(input.value || '').trim();
    });
  }

  async sendFromInput(input) {
    if (!input || sending) return;
    const content = (input.value || '').trim();
    if (!content) return;
    if (content.length > MAX_CONTENT_LENGTH) {
      this.setComposeError(`Message must be ${MAX_CONTENT_LENGTH} characters or fewer`);
      return;
    }

    const { teamId } = this.getSelectedTeam();

    sending = true;
    this.updateComposeState();

    const payload = { messageType: 'text', content };
    if (teamId) payload.teamId = teamId;
    try {
      websocketService.emitToServer('team:join', teamId || 'global');
      const sent = websocketService.emitToServer('message:send', payload);
      if (!sent) {
        const message = await post('/api/sync/message', payload);
        this.handleMessageReceived({
          ...message,
          user_name: message.user_name || 'You'
        });
      }
      input.value = '';
    } catch (error) {
      console.error('Failed to send message:', error);
      this.setComposeError(error.message || 'Failed to send message');
    } finally {
      sending = false;
      this.updateComposeState();
      input.focus();
    }
  }

  setComposeError(message) {
    const hints = [q('#messages-hud-compose-hint'), q('#messages-page-compose-hint')].filter(Boolean);
    hints.forEach((hint) => {
      hint.textContent = message;
      hint.classList.add('is-error');
    });
  }

  setupWebSocketListeners() {
    websocketService.on('message_received', (data) => {
      this.handleMessageReceived(data);
    });
  }

  handleMessageReceived(data) {
    if (!data?.content) return;
    if (data?.id && messageLog.some(msg => msg.id === data.id)) {
      return;
    }

    const timestamp = data.created_at ? new Date(data.created_at) : new Date();
    const messageEntry = {
      id: data.id,
      timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
      teamId: data.team_id,
      userId: data.user_id,
      userName: data.user_name || 'Unknown User',
      userEmail: data.user_email ?? '',
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
    const mobileCountEl = q('#mobile-pill-messages-count');
    const messageCount = messageLog.length;
    
    if (badgeEl) {
      badgeEl.textContent = messageCount;
      badgeEl.style.display = messageCount > 0 ? 'inline-block' : 'none';
    }
    
    if (badgeStatusEl) {
      badgeStatusEl.textContent = messageCount;
    }

    if (mobileCountEl) {
      mobileCountEl.textContent = messageCount;
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
      ? messageLog.filter(msg => msg.teamId === teamFilter || !msg.teamId)
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
        <span style="color: #3b82f6; font-weight: 500;">[${timeStr}] ${this.escapeHtml(msg.userName)}:</span>
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
      ? messageLog.filter(msg => msg.teamId === messageTeamFilter || !msg.teamId)
      : messageLog;

    if (filteredMessages.length === 0) {
      messageEl.innerHTML = '<div class="muted" style="text-align: center; padding: 20px;">No messages for selected team...</div>';
      return;
    }

    const html = filteredMessages.map(msg => {
      const timeStr = messageShowTimestamps ? msg.timestamp.toLocaleTimeString() : '';
      const timePrefix = timeStr ? `[${timeStr}] ` : '';
      const teamInfo = messageTeamFilter ? '' : ` (Team: ${msg.teamId ? msg.teamId.substring(0, 8) + '...' : 'All'})`;

      return `<div style="margin-bottom: 8px; line-height: 1.4;">
        <span style="color: #3b82f6;">${timePrefix}${this.escapeHtml(msg.userName)}${teamInfo}:</span>
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

  syncTeamFiltersFromMap() {
    const mapSelect = q('#map_team_select');
    if (!mapSelect) return;
    const teams = Array.from(mapSelect.options)
      .filter(o => o.value)
      .map(o => ({ id: o.value, name: o.textContent }));
    if (teams.length) {
      this.populateTeamFilters(teams);
    }
  }

  populateTeamFilters(teams) {
    const apply = (select) => {
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">All Teams</option>';
      teams.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        select.appendChild(o);
      });
      if (current && teams.some(t => t.id === current)) {
        select.value = current;
      }
    };

    apply(q('#message_team_filter'));
    apply(q('#message_team_filter_compact'));
  }
}

export const messagesPage = new MessagesPage();
