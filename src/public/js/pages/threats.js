/**
 * Threats page module
 */

import { q, showMessage, showError, showSuccess } from '../utils/dom.js';
import { get } from '../utils/api.js';
import { websocketService } from '../services/websocket.js';

let threatsList = [];
let threatStatusFilter = 'pending';
let threatLevelFilter = '';
let threatAutoRefresh = true;
let threatRefreshInterval = null;

export class ThreatsPage {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    
    this.setupControls();
    this.setupWebSocketListeners();
    this.loadThreats();
    this.initialized = true;
  }

  setupControls() {
    const statusFilter = q('#threat_status_filter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        threatStatusFilter = e.target.value;
        this.loadThreats();
      });
    }

    const levelFilter = q('#threat_level_filter');
    if (levelFilter) {
      levelFilter.addEventListener('change', (e) => {
        threatLevelFilter = e.target.value || '';
        this.loadThreats();
      });
    }

    const refreshBtn = q('#refresh_threats');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadThreats());
    }

    const autoRefreshToggle = q('#threat_auto_refresh');
    if (autoRefreshToggle) {
      autoRefreshToggle.addEventListener('change', (e) => {
        threatAutoRefresh = e.target.checked;
        if (threatAutoRefresh) {
          this.startAutoRefresh();
        } else {
          this.stopAutoRefresh();
        }
      });
    }

    // View all threats link
    const viewAllThreats = q('#view-all-threats');
    if (viewAllThreats) {
      viewAllThreats.addEventListener('click', (e) => {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'threats' } }));
      });
    }
  }

  setupWebSocketListeners() {
    websocketService.on('new_threat_detected', (data) => {
      this.handleNewThreatDetected(data);
    });

    websocketService.on('threat_updated', (data) => {
      this.handleThreatUpdated(data);
    });

    websocketService.on('threat_deleted', (data) => {
      this.handleThreatDeleted(data);
    });
  }

  async loadThreats() {
    try {
      const params = new URLSearchParams();
      if (threatStatusFilter && threatStatusFilter !== 'all') {
        params.append('status', threatStatusFilter);
      }
      if (threatLevelFilter) {
        params.append('threat_level', threatLevelFilter);
      }
      params.append('limit', '50');
      
      const threats = await get(`/api/admin/threats?${params}`);
      threatsList = threats;
      this.updateThreatsDisplay();
      this.updateActiveThreatsPanel();
    } catch (error) {
      console.error('Failed to load threats:', error);
      showError(`Failed to load threats: ${error.message}`);
    }
  }

  updateThreatsDisplay() {
    const threatsEl = q('#threats_list');
    if (!threatsEl) return;

    if (threatsList.length === 0) {
      threatsEl.innerHTML = '<div class="muted" style="text-align: center; padding: 20px;">No threats found</div>';
      this.updateActiveThreatsPanel();
      return;
    }

    const html = threatsList.map(threat => this.renderThreat(threat)).join('');
    threatsEl.innerHTML = html;
    this.updateActiveThreatsPanel();
  }

  renderThreat(threat) {
    const threatLevelColors = {
      'LOW': '#22c55e',
      'MEDIUM': '#f59e0b',
      'HIGH': '#ef4444',
      'CRITICAL': '#dc2626'
    };

    const color = threatLevelColors[threat.threat_level] || '#8b97a7';
    const status = threat.admin_status || 'pending';
    const statusColors = {
      'pending': '#f59e0b',
      'reviewed': '#3b82f6',
      'approved': '#22c55e',
      'dismissed': '#6b7280'
    };

    const locations = threat.extracted_locations || [];
    const locationText = locations.length > 0
      ? `${locations.length} location(s): ${locations.map(loc => loc.name || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`).join(', ')}`
      : 'No location data';

    return `
      <div style="border-bottom: 1px solid #1f2a44; padding: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
              <span style="background: ${color}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">
                ${threat.threat_level}
              </span>
              <span style="background: ${statusColors[status]}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                ${status.toUpperCase()}
              </span>
              <span style="color: var(--muted); font-size: 12px;">
                ${(threat.confidence_score * 100).toFixed(1)}% confidence
              </span>
            </div>
            <div style="font-weight: 600; margin-bottom: 4px;">
              ${threat.threat_type || 'Unknown Threat Type'}
            </div>
            <div style="color: var(--text); margin-bottom: 8px; line-height: 1.4;">
              ${threat.ai_summary || 'No summary available'}
            </div>
            <div style="color: var(--muted); font-size: 12px; margin-bottom: 8px;">
              <strong>Area:</strong> ${threat.geographical_area || 'Unknown'}<br>
              <strong>Locations:</strong> ${locationText}<br>
              <strong>Keywords:</strong> ${(threat.keywords || []).join(', ') || 'None'}<br>
              <strong>Detected:</strong> ${new Date(threat.created_at).toLocaleString()}<br>
              ${threat.citations && threat.citations.length > 0 ? `
                <strong>Sources:</strong> ${threat.citations.length} citation${threat.citations.length !== 1 ? 's' : ''} available
              ` : ''}
            </div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px; margin-left: 16px;">
            ${status === 'pending' ? `
              <button onclick="window.threatsPage.reviewThreat('${threat.id}', 'approved')" style="background: #22c55e; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                Approve & Create Annotation
              </button>
              <button onclick="window.threatsPage.reviewThreat('${threat.id}', 'dismissed')" style="background: #6b7280; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                Dismiss
              </button>
            ` : `
              <div style="color: var(--muted); font-size: 12px; text-align: center;">
                ${status === 'approved' ? '✓ Approved' : status === 'dismissed' ? '✗ Dismissed' : 'Reviewed'}
              </div>
            `}
            <button onclick="window.threatsPage.showThreatDetails('${threat.id}')" style="background: #3b82f6; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
              View Details
            </button>
            <button onclick="window.threatsPage.deleteThreat('${threat.id}')" style="background: #ef4444; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }

  updateActiveThreatsPanel() {
    const panelEl = q('#active_threats_panel');
    if (!panelEl) return;

    // Filter for CRITICAL and HIGH threats that are pending or reviewed
    const activeThreats = threatsList.filter(t =>
      (t.threat_level === 'CRITICAL' || t.threat_level === 'HIGH') &&
      (t.admin_status === 'pending' || t.admin_status === 'reviewed')
    );

    // Update status bar count
    const activeThreatsCount = q('#k_active_threats');
    if (activeThreatsCount) {
      activeThreatsCount.textContent = activeThreats.length;
      activeThreatsCount.style.color = activeThreats.length > 0 ? '#ef4444' : '#22c55e';
    }

    if (activeThreats.length === 0) {
      panelEl.innerHTML = '<div class="muted" style="text-align: center; padding: 20px; font-size: 13px;">No active threats</div>';
      return;
    }

    // Show only top 5 most critical
    const topThreats = activeThreats.slice(0, 5);
    const html = topThreats.map(threat => this.renderThreatCompact(threat)).join('');
    panelEl.innerHTML = html;
  }

  renderThreatCompact(threat) {
    const threatLevelColors = {
      'LOW': '#22c55e',
      'MEDIUM': '#f59e0b',
      'HIGH': '#ef4444',
      'CRITICAL': '#dc2626'
    };

    const color = threatLevelColors[threat.threat_level] || '#8b97a7';
    const status = threat.admin_status || 'pending';

    return `
      <div style="border-bottom: 1px solid #1f2a44; padding: 12px; margin-bottom: 8px; background: #0d1b34; border-radius: 6px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="background: ${color}; color: white; padding: 3px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">
            ${threat.threat_level}
          </span>
          <span style="color: var(--text); font-weight: 600; font-size: 12px; flex: 1;">
            ${threat.threat_type || 'Unknown'}
          </span>
        </div>
        <div style="color: var(--muted); font-size: 11px; line-height: 1.4; margin-bottom: 8px;">
          ${(threat.ai_summary || 'No summary').substring(0, 100)}${threat.ai_summary && threat.ai_summary.length > 100 ? '...' : ''}
        </div>
        <div style="display: flex; gap: 6px;">
          ${status === 'pending' ? `
            <button onclick="window.threatsPage.reviewThreat('${threat.id}', 'approved')" style="background: #22c55e; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; flex: 1;">
              Approve
            </button>
            <button onclick="window.threatsPage.reviewThreat('${threat.id}', 'dismissed')" style="background: #6b7280; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; flex: 1;">
              Dismiss
            </button>
          ` : `
            <button onclick="window.threatsPage.showThreatDetails('${threat.id}')" style="background: #3b82f6; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; width: 100%;">
              View Details
            </button>
          `}
        </div>
      </div>
    `;
  }

  async reviewThreat(threatId, status) {
    try {
      // Implementation will be added - needs team selection for approved threats
      showMessage(`Threat ${status} functionality coming soon`, 'info');
    } catch (error) {
      showError(`Failed to review threat: ${error.message}`);
    }
  }

  async deleteThreat(threatId) {
    if (!confirm('Are you sure you want to delete this threat?')) return;
    
    try {
      // Implementation will use api.del()
      showMessage('Delete threat functionality coming soon', 'info');
    } catch (error) {
      showError(`Failed to delete threat: ${error.message}`);
    }
  }

  showThreatDetails(threatId) {
    const threat = threatsList.find(t => t.id === threatId);
    if (!threat) {
      showError('Threat not found');
      return;
    }
    
    // Show threat details in a modal or expand view
    showMessage(`Viewing details for threat: ${threat.threat_type}`, 'info');
  }

  handleNewThreatDetected(data) {
    this.loadThreats();
    showMessage(`New ${data.threat_level} threat detected: ${data.threat_type}`, 'error');
  }

  handleThreatUpdated(data) {
    const index = threatsList.findIndex(t => t.id === data.id);
    if (index !== -1) {
      threatsList[index] = data;
      this.updateThreatsDisplay();
    }
  }

  handleThreatDeleted(data) {
    threatsList = threatsList.filter(t => t.id !== data.id);
    this.updateThreatsDisplay();
  }

  startAutoRefresh() {
    if (threatRefreshInterval) return;
    threatRefreshInterval = setInterval(() => {
      this.loadThreats();
    }, 30000); // Refresh every 30 seconds
  }

  stopAutoRefresh() {
    if (threatRefreshInterval) {
      clearInterval(threatRefreshInterval);
      threatRefreshInterval = null;
    }
  }

  destroy() {
    this.stopAutoRefresh();
  }
}

export const threatsPage = new ThreatsPage();
// Make available globally for onclick handlers
window.threatsPage = threatsPage;
