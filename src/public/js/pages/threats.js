/**
 * Threats page module
 */

import { q, showMessage, showError, showSuccess } from '../utils/dom.js';
import { get, post, put, del } from '../utils/api.js';
import { websocketService } from '../services/websocket.js';

let threatsList = [];
let threatStatusFilter = 'pending';
let threatLevelFilter = '';
let threatAutoRefresh = true;
let threatRefreshInterval = null;

/** OSM tile URL for a given zoom; returns tile containing (lat, lng) and fraction of point within tile for marker positioning */
function getOsmTileUrlAndFraction(lat, lng, zoom = 10) {
  const n = Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const tileLngMin = (x / n) * 360 - 180;
  const tileLngMax = ((x + 1) / n) * 360 - 180;
  const tileLatMax = (180 / Math.PI) * (2 * Math.atan(Math.exp(Math.PI * (1 - (2 * y) / n))) - 90);
  const tileLatMin = (180 / Math.PI) * ((2 * Math.atan(Math.exp(Math.PI * (1 - (2 * (y + 1)) / n)))) - 90);
  const fx = (lng - tileLngMin) / (tileLngMax - tileLngMin);
  const fy = (lat - tileLatMin) / (tileLatMax - tileLatMin);
  const url = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
  return { url, fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, 1 - fy)) };
}

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

    // View all threats link – navigate to Threat Review page
    const viewAllThreats = q('#view-all-threats');
    if (viewAllThreats) {
      viewAllThreats.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
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
    const loc = locations.length > 0 ? locations[0] : null;
    const minimapSize = 120;
    const minimapFull = loc
      ? (() => {
          const { url, fx, fy } = getOsmTileUrlAndFraction(loc.lat, loc.lng, 10);
          return `
            <div class="threat-minimap-wrap" style="width: ${minimapSize}px; height: ${minimapSize}px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: #0d1b34; position: relative; pointer-events: none; border: 1px solid #1f2a44;">
              <img src="${url}" alt="Map" style="width: 100%; height: 100%; object-fit: cover; display: block;" loading="lazy" />
              <span style="position: absolute; left: ${fx * 100}%; top: ${fy * 100}%; transform: translate(-50%, -50%); width: 14px; height: 14px; background: #ef4444; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></span>
            </div>`;
        })()
      : '';

    return `
      <div style="border-bottom: 1px solid #1f2a44; padding: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;">
          <div style="flex: 1; min-width: 0;">
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
            <div style="color: var(--muted); font-size: 12px;">
              <strong>Area:</strong> ${threat.geographical_area || 'Unknown'}<br>
              <strong>Locations:</strong> ${locationText}<br>
              <strong>Keywords:</strong> ${(threat.keywords || []).join(', ') || 'None'}<br>
              <strong>Detected:</strong> ${new Date(threat.created_at).toLocaleString()}<br>
              ${threat.citations && threat.citations.length > 0 ? `
                <strong>Sources:</strong> ${threat.citations.length} citation${threat.citations.length !== 1 ? 's' : ''} available
              ` : ''}
            </div>
          </div>
          ${minimapFull}
          <div style="display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;">
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
    const hudPanelEl = q('#threats-hud-content');
    const hudBadgeEl = q('#threats-hud-badge');

    // All pending and reviewed threats (for review in HUD and panels)
    const activeThreats = threatsList.filter(t =>
      (t.admin_status === 'pending' || t.admin_status === 'reviewed')
    );

    // Update status bar count
    const activeThreatsCount = q('#k_active_threats');
    if (activeThreatsCount) {
      activeThreatsCount.textContent = activeThreats.length;
      activeThreatsCount.style.color = activeThreats.length > 0 ? '#ef4444' : '#22c55e';
    }

    // Update HUD badge
    if (hudBadgeEl) {
      hudBadgeEl.textContent = activeThreats.length;
      hudBadgeEl.style.display = activeThreats.length > 0 ? 'inline-block' : 'none';
    }

    const emptyHtml = '<div class="muted" style="text-align: center; padding: 20px; font-size: 13px;">No active threats</div>';

    if (activeThreats.length === 0) {
      if (panelEl) panelEl.innerHTML = emptyHtml;
      if (hudPanelEl) hudPanelEl.innerHTML = emptyHtml;
      return;
    }

    // Show only top 5 most critical
    const topThreats = activeThreats.slice(0, 5);
    const html = topThreats.map(threat => this.renderThreatCompact(threat)).join('');
    
    if (panelEl) panelEl.innerHTML = html;
    if (hudPanelEl) hudPanelEl.innerHTML = html;
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
    const hasLocation = threat.extracted_locations && threat.extracted_locations.length > 0;
    const loc = hasLocation ? threat.extracted_locations[0] : null;
    const minimapSizeCompact = 64;
    const minimapCompact = loc
      ? (() => {
          const { url, fx, fy } = getOsmTileUrlAndFraction(loc.lat, loc.lng, 10);
          return `
        <div class="threat-minimap-wrap" style="width: ${minimapSizeCompact}px; height: ${minimapSizeCompact}px; flex-shrink: 0; border-radius: 4px; overflow: hidden; background: #0d1b34; position: relative; pointer-events: none; border: 1px solid #1f2a44;">
          <img src="${url}" alt="Map" style="width: 100%; height: 100%; object-fit: cover; display: block;" loading="lazy" />
          <span style="position: absolute; left: ${fx * 100}%; top: ${fy * 100}%; transform: translate(-50%, -50%); width: 10px; height: 10px; background: #ef4444; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 2px rgba(0,0,0,0.5);"></span>
        </div>`;
        })()
      : '';

    return `
      <div class="threat-card-compact" data-threat-id="${threat.id}" style="border-bottom: 1px solid #1f2a44; padding: 12px; margin-bottom: 8px; background: #0d1b34; border-radius: 6px; cursor: pointer; transition: background-color 0.2s ease; display: flex; align-items: stretch; gap: 12px;" 
           onmouseover="this.style.background='#0f1f3a'" 
           onmouseout="this.style.background='#0d1b34'"
           onclick="window.threatsPage?.panToThreatOnMap('${threat.id}')">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="background: ${color}; color: white; padding: 3px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">
              ${threat.threat_level}
            </span>
            <span style="color: var(--text); font-weight: 600; font-size: 12px;">
              ${threat.threat_type || 'Unknown'}
            </span>
            ${hasLocation ? '<span style="color: var(--muted); font-size: 10px;">📍</span>' : ''}
          </div>
          <div style="color: var(--muted); font-size: 11px; line-height: 1.4;">
            ${(threat.ai_summary || 'No summary').substring(0, 100)}${threat.ai_summary && threat.ai_summary.length > 100 ? '...' : ''}
          </div>
        </div>
        ${minimapCompact}
        <div style="display: flex; flex-direction: column; gap: 6px; justify-content: center; flex-shrink: 0;" onclick="event.stopPropagation()">
          ${status === 'pending' ? `
            <button onclick="window.threatsPage.reviewThreat('${threat.id}', 'approved')" style="background: #22c55e; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer;">
              Approve
            </button>
            <button onclick="window.threatsPage.reviewThreat('${threat.id}', 'dismissed')" style="background: #6b7280; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer;">
              Dismiss
            </button>
          ` : `
            <button onclick="window.threatsPage.showThreatDetails('${threat.id}')" style="background: #3b82f6; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer;">
              View Details
            </button>
          `}
        </div>
      </div>
    `;
  }

  panToThreatOnMap(threatId) {
    // Pan map to threat location
    if (window.adminMap && window.adminMap.panToThreat) {
      window.adminMap.panToThreat(threatId);
    }
  }

  async reviewThreat(threatId, status) {
    try {
      const threat = threatsList.find(t => t.id === threatId);
      if (!threat) {
        showError('Threat not found');
        return;
      }

      if (status === 'dismissed') {
        // Simple dismissal - no team selection needed
        await this.updateThreatStatus(threatId, 'dismissed');
        showMessage('Threat dismissed', 'success');
        this.loadThreats();
        return;
      }

      if (status === 'approved') {
        // Need team selection for approval
        await this.showThreatApprovalModal(threat);
        return;
      }

      // For 'reviewed' status, just update status
      await this.updateThreatStatus(threatId, status);
      showMessage(`Threat marked as ${status}`, 'success');
      await this.loadThreats();
      
      // Refresh threat manager on map
      if (window.adminMap && window.adminMap.threatManager) {
        await window.adminMap.threatManager.refresh();
      }
    } catch (error) {
      showError(`Failed to review threat: ${error.message}`);
    }
  }

  async showThreatApprovalModal(threat) {
    // Get teams for selection
    const teams = await get('/api/admin/teams');
    
    // Create modal HTML
    const modalHtml = `
      <div id="threat-approval-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.7); z-index: 10000; display: flex; align-items: center; justify-content: center;">
        <div style="background: var(--panel); border: 1px solid #1f2a44; border-radius: 12px; padding: 24px; max-width: 500px; width: 90%; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);">
          <h3 style="margin: 0 0 16px; color: var(--text);">Approve & Send Threat to Field</h3>
          
          <div style="margin-bottom: 16px; padding: 12px; background: #0d1b34; border-radius: 6px; border-left: 4px solid #ef4444;">
            <div style="font-weight: 600; margin-bottom: 4px; color: var(--text);">
              ${threat.threat_level} Threat: ${threat.threat_type || 'Unknown'}
            </div>
            <div style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">
              Confidence: ${(threat.confidence_score * 100).toFixed(1)}%
            </div>
            <div style="font-size: 12px; color: var(--muted);">
              ${threat.ai_summary || 'No summary available'}
            </div>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; color: var(--text); font-weight: 500;">
              Send threat to:
            </label>
            <select id="threat-approval-team" style="width: 100%; padding: 8px 12px; border: 1px solid #233153; border-radius: 6px; background: #0c1527; color: var(--text); font-size: 14px;">
              <option value="" selected>All teams</option>
              ${teams.map(team => `<option value="${team.id}">${team.name}</option>`).join('')}
            </select>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; color: var(--text); font-weight: 500;">
              Annotation Type:
            </label>
            <select id="threat-approval-type" style="width: 100%; padding: 8px 12px; border: 1px solid #233153; border-radius: 6px; background: #0c1527; color: var(--text); font-size: 14px;">
              <option value="poi">Point of Interest (POI)</option>
              <option value="area">Area/Zone</option>
            </select>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; color: var(--text); font-weight: 500;">
              Custom Label (optional):
            </label>
            <input type="text" id="threat-approval-label" placeholder="Leave blank for default" 
                   style="width: 100%; padding: 8px 12px; border: 1px solid #233153; border-radius: 6px; background: #0c1527; color: var(--text); font-size: 14px;">
          </div>

          <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px;">
            <button id="threat-approval-cancel" 
                    style="padding: 8px 16px; border-radius: 6px; border: 1px solid #223056; background: #0c1527; color: var(--text); cursor: pointer; font-weight: 500;">
              Cancel
            </button>
            <button id="threat-approval-submit" 
                    style="padding: 8px 16px; border-radius: 6px; border: none; background: linear-gradient(180deg, #22c55e, #16a34a); color: white; cursor: pointer; font-weight: 600;">
              Approve & Send to Field
            </button>
          </div>
        </div>
      </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('threat-approval-modal');
    if (existingModal) existingModal.remove();

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Setup event handlers
    const modal = document.getElementById('threat-approval-modal');
    const cancelBtn = document.getElementById('threat-approval-cancel');
    const submitBtn = document.getElementById('threat-approval-submit');

    const closeModal = () => {
      if (modal) modal.remove();
    };

    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    submitBtn.addEventListener('click', async () => {
      const teamSelect = document.getElementById('threat-approval-team');
      const teamId = teamSelect.value.trim() || null;
      const annotationType = document.getElementById('threat-approval-type').value;
      const customLabel = document.getElementById('threat-approval-label').value.trim();

      try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        const response = await post(`/api/admin/threats/${threat.id}/create-annotation`, {
          teamId,
          annotationType,
          customLabel: customLabel || undefined
        });

        if (response.success) {
          showMessage(teamId ? 'Threat approved and sent to field team!' : 'Threat approved and sent to all teams!', 'success');
          closeModal();
          await this.loadThreats();
          
          // Refresh threat manager on map
          if (window.adminMap && window.adminMap.threatManager) {
            await window.adminMap.threatManager.refresh();
          }
          
          // Pan map to threat location if map is available
          if (window.adminMap && window.adminMap.panToThreat) {
            window.adminMap.panToThreat(threat.id);
          }
        }
      } catch (error) {
        showError(`Failed to approve threat: ${error.message}`);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Approve & Send to Field';
      }
    });
  }

  async updateThreatStatus(threatId, status) {
    await put(`/api/admin/threats/${threatId}/status`, { status });
  }

  async deleteThreat(threatId) {
    if (!confirm('Are you sure you want to delete this threat?')) return;

    try {
      await del(`/api/admin/threats/${threatId}`);
      showMessage('Threat deleted', 'success');
      await this.loadThreats();
      if (window.adminMap && window.adminMap.threatManager) {
        await window.adminMap.threatManager.refresh();
      }
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

    const threatLevelColors = {
      'LOW': '#22c55e',
      'MEDIUM': '#f59e0b',
      'HIGH': '#ef4444',
      'CRITICAL': '#dc2626'
    };
    const statusColors = {
      'pending': '#f59e0b',
      'reviewed': '#3b82f6',
      'approved': '#22c55e',
      'dismissed': '#6b7280'
    };
    const color = threatLevelColors[threat.threat_level] || '#8b97a7';
    const status = threat.admin_status || 'pending';
    const locations = threat.extracted_locations || [];
    const locationText = locations.length > 0
      ? locations.map(loc => loc.name || `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`).join('; ')
      : 'No location data';
    const citationUrl = (c) => {
      if (!c) return null;
      if (typeof c === 'string' && c.startsWith('http')) return c;
      const u = c.url || c.link || c.source_url || c.uri || c.href ||
        (c.web_citation && c.web_citation.url) || (c.x_citation && c.x_citation.url);
      if (u && typeof u === 'string' && (u.startsWith('http') || u.startsWith('//'))) return u.startsWith('//') ? 'https:' + u : u;
      const author = c.author || c.username;
      const postId = c.post_id || c.status_id || c.tweet_id || c.id;
      const postIdStr = postId != null ? String(postId) : '';
      const isNumericId = /^\d{1,20}$/.test(postIdStr);
      if (author && isNumericId) return `https://x.com/${encodeURIComponent(author)}/status/${postIdStr}`;
      return u && typeof u === 'string' ? u : null;
    };
    const normalizeCitations = (raw) => {
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string') {
        try { return JSON.parse(raw || '[]'); } catch (_) { return []; }
      }
      return [];
    };
    const citationsList = normalizeCitations(threat.citations);
    const citationLabel = (c) => {
      if (!c) return 'Source';
      if (typeof c === 'string') return c.length > 80 ? c.substring(0, 80) + '…' : c;
      return (c.title || c.content_preview || c.url || c.link || c.uri || 'Source').substring(0, 80) + ((c.title || c.content_preview || c.url || c.link || c.uri || '').length > 80 ? '…' : '');
    };
    const escapeAttr = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    const citationsHtml = citationsList.length > 0
      ? `<div style="margin-top: 8px;"><strong>Sources:</strong><ul style="margin: 4px 0 0 16px; padding: 0;">${citationsList.slice(0, 10).map(c => {
        const href = citationUrl(c);
        const label = citationLabel(c);
        const safeLabel = escapeAttr(label || 'Source').substring(0, 80);
        if (href) {
          return `<li><a href="${escapeAttr(href)}" target="_blank" rel="noopener" style="color: var(--accent);">${safeLabel}</a></li>`;
        }
        return `<li><span style="color: var(--muted);">${safeLabel}</span></li>`;
      }).join('')}</ul></div>`
      : '';

    const modalHtml = `
      <div id="threat-details-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.7); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 16px;">
        <div style="background: var(--panel); border: 1px solid #1f2a44; border-radius: 12px; padding: 24px; max-width: 560px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
            <h3 style="margin: 0; color: var(--text);">Threat Details</h3>
            <button id="threat-details-close" type="button" style="background: none; border: none; color: var(--muted); font-size: 20px; cursor: pointer; padding: 0 4px;" aria-label="Close">×</button>
          </div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
            <span style="background: ${color}; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 600;">${threat.threat_level}</span>
            <span style="background: ${statusColors[status]}; color: white; padding: 4px 10px; border-radius: 4px; font-size: 12px;">${status.toUpperCase()}</span>
            <span style="color: var(--muted); font-size: 12px;">${(threat.confidence_score * 100).toFixed(1)}% confidence</span>
          </div>
          <div style="font-weight: 600; margin-bottom: 6px; color: var(--text);">${threat.threat_type || 'Unknown Threat Type'}</div>
          <div style="color: var(--text); margin-bottom: 12px; line-height: 1.5;">${threat.ai_summary || 'No summary available'}</div>
          <div style="color: var(--muted); font-size: 13px; line-height: 1.6;">
            <p style="margin: 4px 0;"><strong>Area:</strong> ${threat.geographical_area || 'Unknown'}</p>
            <p style="margin: 4px 0;"><strong>Locations:</strong> ${locationText}</p>
            <p style="margin: 4px 0;"><strong>Keywords:</strong> ${(threat.keywords || []).join(', ') || 'None'}</p>
            <p style="margin: 4px 0;"><strong>Detected:</strong> ${new Date(threat.created_at).toLocaleString()}</p>
            ${citationsHtml}
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 20px; padding-top: 16px; border-top: 1px solid #1f2a44;">
            ${status === 'pending' ? `
              <button type="button" id="threat-details-approve" style="background: #22c55e; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 500;">Approve & Create Annotation</button>
              <button type="button" id="threat-details-dismiss" style="background: #6b7280; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">Dismiss</button>
            ` : ''}
            <button type="button" id="threat-details-pan" style="background: #3b82f6; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer;">Show on Map</button>
            <button type="button" id="threat-details-close-btn" style="background: #0c1527; color: var(--text); padding: 8px 16px; border: 1px solid #233153; border-radius: 6px; font-size: 13px; cursor: pointer;">Close</button>
          </div>
        </div>
      </div>
    `;

    const existingModal = document.getElementById('threat-details-modal');
    if (existingModal) existingModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('threat-details-modal');
    const closeModal = () => {
      if (modal) modal.remove();
    };

    modal.querySelector('#threat-details-close').addEventListener('click', closeModal);
    modal.querySelector('#threat-details-close-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    const panBtn = document.getElementById('threat-details-pan');
    if (panBtn) {
      panBtn.addEventListener('click', () => {
        closeModal();
        document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'dashboard' } }));
        const loc = threat.extracted_locations && threat.extracted_locations[0];
        setTimeout(() => {
          if (!window.adminMap) {
            showMessage('Map is loading. Try "Show on Map" again in a moment.', 'info');
            return;
          }
          if (loc && loc.lat != null && loc.lng != null && typeof window.adminMap.flyToLocation === 'function') {
            window.adminMap.flyToLocation(loc.lng, loc.lat);
            if (typeof window.adminMap.panToThreat === 'function') {
              window.adminMap.panToThreat(threatId);
            }
          } else if (typeof window.adminMap.panToThreat === 'function') {
            window.adminMap.panToThreat(threatId);
          } else {
            showMessage('No location for this threat.', 'info');
          }
        }, 500);
      });
    }

    if (status === 'pending') {
      document.getElementById('threat-details-approve').addEventListener('click', () => {
        closeModal();
        this.showThreatApprovalModal(threat);
      });
      document.getElementById('threat-details-dismiss').addEventListener('click', async () => {
        closeModal();
        await this.reviewThreat(threatId, 'dismissed');
      });
    }
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
