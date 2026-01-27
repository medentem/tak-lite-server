let token = localStorage.getItem('taklite:token') || '';
const q = (s)=>document.querySelector(s);

// WebSocket connection for real-time updates
let socket = null;
let activityLog = [];
const MAX_ACTIVITY_ITEMS = 50;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Message monitoring variables
let messageLog = [];
const MAX_MESSAGE_ITEMS = 100;
let messageTeamFilter = '';
let messageAutoScroll = true;
let messageShowTimestamps = true;

// Threat review variables
let threatsList = [];
let threatStatusFilter = 'pending';
let threatLevelFilter = '';
let threatAutoRefresh = true;
let threatRefreshInterval = null;

// Real-time activity logging
function addActivityLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = { timestamp, message, type };
  
  activityLog.unshift(logEntry);
  if (activityLog.length > MAX_ACTIVITY_ITEMS) {
    activityLog = activityLog.slice(0, MAX_ACTIVITY_ITEMS);
  }
  
  updateActivityDisplay();
}

function updateActivityDisplay() {
  const activityEl = q('#activity_log');
  if (!activityEl) return;
  
  if (activityLog.length === 0) {
    activityEl.innerHTML = '<div class="muted">Waiting for activity...</div>';
    return;
  }
  
  const html = activityLog.map(entry => {
    const color = entry.type === 'error' ? '#ef4444' : 
                  entry.type === 'success' ? '#22c55e' : 
                  entry.type === 'warning' ? '#f59e0b' : '#3b82f6';
    return `<div style="color: ${color};">[${entry.timestamp}] ${entry.message}</div>`;
  }).join('');
  
  activityEl.innerHTML = html;
}

// Message monitoring functions
function handleMessageReceived(data) {
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
  
  updateMessageDisplay();
  addActivityLog(`Message from ${messageEntry.userName} in team ${data.team_id}`, 'info');
}

function updateMessageDisplay() {
  const messageEl = q('#message_monitor');
  const compactEl = q('#message_monitor_compact');
  
  // Update compact message monitor
  if (compactEl) {
    updateCompactMessageDisplay(compactEl);
  }
  
  // Update full message monitor if it exists
  if (messageEl) {
    updateFullMessageDisplay(messageEl);
  }
  
  // Update status bar count
  const recentMessagesCount = q('#k_recent_messages');
  if (recentMessagesCount) {
    const filteredCount = messageTeamFilter 
      ? messageLog.filter(msg => msg.teamId === messageTeamFilter).length
      : messageLog.length;
    recentMessagesCount.textContent = filteredCount;
  }
}

function updateCompactMessageDisplay(messageEl) {
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
      <span style="color: #e6edf3;">${escapeHtml(msg.content)}</span>
    </div>`;
  }).join('');
  
  messageEl.innerHTML = html;
  
  // Auto-scroll to bottom
  messageEl.scrollTop = messageEl.scrollHeight;
}

function updateFullMessageDisplay(messageEl) {
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
      <span style="color: #e6edf3;">${escapeHtml(msg.content)}</span>
    </div>`;
  }).join('');
  
  messageEl.innerHTML = html;
  
  // Auto-scroll to bottom if enabled
  if (messageAutoScroll) {
    messageEl.scrollTop = messageEl.scrollHeight;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function clearMessages() {
  messageLog = [];
  updateMessageDisplay();
  addActivityLog('Message log cleared', 'info');
}

function setupMessageControls() {
  // Team filter (full monitor)
  const teamFilter = q('#message_team_filter');
  if (teamFilter) {
    teamFilter.addEventListener('change', (e) => {
      messageTeamFilter = e.target.value || '';
      updateMessageDisplay();
    });
  }
  
  // Team filter (compact monitor)
  const teamFilterCompact = q('#message_team_filter_compact');
  if (teamFilterCompact) {
    teamFilterCompact.addEventListener('change', (e) => {
      updateMessageDisplay();
    });
  }
  
  // Clear messages button (full)
  const clearBtn = q('#clear_messages');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearMessages);
  }
  
  // Clear messages button (compact)
  const clearBtnCompact = q('#clear_messages_compact');
  if (clearBtnCompact) {
    clearBtnCompact.addEventListener('click', clearMessages);
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
      updateMessageDisplay();
    });
  }
}

// Threat review functions
async function loadThreats() {
  try {
    const params = new URLSearchParams();
    if (threatStatusFilter) params.append('status', threatStatusFilter);
    if (threatLevelFilter) params.append('threat_level', threatLevelFilter);
    params.append('limit', '50');
    
    const response = await fetch(`/api/admin/threats?${params}`, {
      headers: hdrs()
    });
    
    if (!response.ok) {
      throw new Error(`Failed to load threats: ${response.status}`);
    }
    
    threatsList = await response.json();
    updateThreatsDisplay();
    addActivityLog(`Loaded ${threatsList.length} threats`, 'info');
  } catch (error) {
    console.error('Failed to load threats:', error);
    addActivityLog(`Failed to load threats: ${error.message}`, 'error');
  }
}

// Update active threats panel (compact view for dashboard)
function updateActiveThreatsPanel() {
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
  
  const html = topThreats.map(threat => {
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
            <button onclick="reviewThreat('${threat.id}', 'approved')" style="background: #22c55e; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; flex: 1;">
              Approve
            </button>
            <button onclick="reviewThreat('${threat.id}', 'dismissed')" style="background: #6b7280; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; flex: 1;">
              Dismiss
            </button>
          ` : `
            <button onclick="showThreatDetails('${threat.id}')" style="background: #3b82f6; color: white; padding: 4px 8px; border: none; border-radius: 4px; font-size: 11px; cursor: pointer; width: 100%;">
              View Details
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
  
  panelEl.innerHTML = html;
}

function updateThreatsDisplay() {
  const threatsEl = q('#threats_list');
  if (!threatsEl) return;
  
  if (threatsList.length === 0) {
    threatsEl.innerHTML = '<div class="muted" style="text-align: center; padding: 20px;">No threats found</div>';
    updateActiveThreatsPanel();
    return;
  }
  
  const html = threatsList.map(threat => {
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
              <button onclick="reviewThreat('${threat.id}', 'approved')" style="background: #22c55e; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                Approve & Create Annotation
              </button>
              <button onclick="reviewThreat('${threat.id}', 'dismissed')" style="background: #6b7280; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
                Dismiss
              </button>
            ` : `
              <div style="color: var(--muted); font-size: 12px; text-align: center;">
                ${status === 'approved' ? '✓ Approved' : status === 'dismissed' ? '✗ Dismissed' : 'Reviewed'}
              </div>
            `}
            <button onclick="showThreatDetails('${threat.id}')" style="background: #3b82f6; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
              View Details
            </button>
            <button onclick="deleteThreat('${threat.id}')" style="background: #ef4444; color: white; padding: 6px 12px; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
              Delete
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  threatsEl.innerHTML = html;
  
  // Also update the compact panel if it exists
  updateActiveThreatsPanel();
}

async function reviewThreat(threatId, status) {
  try {
    if (status === 'approved') {
      // For approved threats, we need to create an annotation
      // First, get the teams to let the user choose which team to create the annotation for
      const teamsResponse = await fetch('/api/admin/teams', { headers: hdrs() });
      const teams = await teamsResponse.json();
      
      if (teams.length === 0) {
        showMessage('No teams available to create annotation', 'error');
        return;
      }
      
      // For now, create annotation for the first team
      // In a more sophisticated implementation, you'd show a team selection dialog
      const teamId = teams[0].id;
      
      const response = await fetch(`/api/admin/threats/${threatId}/create-annotation`, {
        method: 'POST',
        headers: hdrs(),
        body: JSON.stringify({ teamId })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create annotation: ${response.status}`);
      }
      
      addActivityLog(`Threat approved and annotation created`, 'success');
      showMessage('Threat approved and annotation created!', 'success', 3000);
    } else {
      // For other statuses, just update the status
      const response = await fetch(`/api/admin/threats/${threatId}/status`, {
        method: 'PUT',
        headers: hdrs(),
        body: JSON.stringify({ status })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to update threat status: ${response.status}`);
      }
      
      addActivityLog(`Threat ${status}`, 'success');
      showMessage(`Threat ${status} successfully`, 'success', 3000);
    }
    
    // Force refresh the threats list to ensure status updates are visible
    await loadThreats();
  } catch (error) {
    console.error('Failed to review threat:', error);
    addActivityLog(`Failed to review threat: ${error.message}`, 'error');
    showMessage(`Failed to review threat: ${error.message}`, 'error');
  }
}

async function deleteThreat(threatId) {
  if (!confirm('Are you sure you want to delete this threat? This action cannot be undone.')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/admin/threats/${threatId}`, {
      method: 'DELETE',
      headers: hdrs()
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete threat: ${response.status}`);
    }
    
    addActivityLog(`Threat deleted`, 'success');
    showMessage('Threat deleted successfully', 'success', 3000);
    
    // Force refresh the threats list
    await loadThreats();
  } catch (error) {
    console.error('Failed to delete threat:', error);
    addActivityLog(`Failed to delete threat: ${error.message}`, 'error');
    showMessage(`Failed to delete threat: ${error.message}`, 'error');
  }
}

async function createThreatAnnotation(threatId, teamId) {
  try {
    const response = await fetch(`/api/admin/threats/${threatId}/create-annotation`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ teamId })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create annotation: ${response.status}`);
    }
    
    const result = await response.json();
    addActivityLog(`Created annotation for threat`, 'success');
    showMessage('Threat annotation created successfully!', 'success', 3000);
    
    // Refresh map data if available
    if (window.adminMap && window.adminMap.isAuthenticated()) {
      await window.adminMap.loadMapData();
    }
    
    await loadThreats(); // Refresh the list
  } catch (error) {
    console.error('Failed to create threat annotation:', error);
    addActivityLog(`Failed to create annotation: ${error.message}`, 'error');
    showMessage(`Failed to create annotation: ${error.message}`, 'error');
  }
}

function showThreatDetails(threatId) {
  const threat = threatsList.find(t => t.id === threatId);
  if (!threat) return;
  
  const threatLevelColors = {
    'LOW': '#22c55e',
    'MEDIUM': '#f59e0b', 
    'HIGH': '#ef4444',
    'CRITICAL': '#dc2626'
  };
  
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
    background: rgba(0,0,0,0.8); z-index: 2000; 
    display: flex; align-items: center; justify-content: center;
  `;
  
  modal.innerHTML = `
    <div style="background: var(--panel); border: 1px solid #1f2a44; border-radius: 12px; padding: 24px; max-width: 600px; max-height: 80vh; overflow-y: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; color: var(--text);">Threat Details</h3>
        <button onclick="this.closest('.modal').remove()" style="background: none; border: none; color: var(--muted); font-size: 24px; cursor: pointer;">&times;</button>
      </div>
      
      <div style="margin-bottom: 16px;">
        <div style="display: flex; gap: 12px; margin-bottom: 12px;">
          <span style="background: ${threatLevelColors[threat.threat_level] || '#8b97a7'}; color: white; padding: 6px 12px; border-radius: 6px; font-weight: 600;">
            ${threat.threat_level}
          </span>
          <span style="background: #3b82f6; color: white; padding: 6px 12px; border-radius: 6px;">
            ${threat.threat_type || 'Unknown'}
          </span>
          <span style="color: var(--muted); padding: 6px 12px;">
            ${(threat.confidence_score * 100).toFixed(1)}% confidence
          </span>
        </div>
        
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--text);">Summary:</strong>
          <div style="color: var(--text); margin-top: 4px; line-height: 1.4;">
            ${threat.ai_summary || 'No summary available'}
          </div>
        </div>
        
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--text);">Geographical Area:</strong>
          <div style="color: var(--muted); margin-top: 4px;">
            ${threat.geographical_area || 'Unknown'}
          </div>
        </div>
        
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--text);">Locations:</strong>
          <div style="color: var(--muted); margin-top: 4px;">
            ${(threat.extracted_locations || []).map(loc => 
              `${loc.name || 'Unnamed'} (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}) - ${(loc.confidence * 100).toFixed(1)}% confidence`
            ).join('<br>') || 'No location data'}
          </div>
        </div>
        
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--text);">Keywords:</strong>
          <div style="color: var(--muted); margin-top: 4px;">
            ${(threat.keywords || []).join(', ') || 'None'}
          </div>
        </div>
        
        <div style="margin-bottom: 12px;">
          <strong style="color: var(--text);">Detected:</strong>
          <div style="color: var(--muted); margin-top: 4px;">
            ${new Date(threat.created_at).toLocaleString()}
          </div>
        </div>
        
        ${threat.reasoning ? `
          <div style="margin-bottom: 12px;">
            <strong style="color: var(--text);">AI Reasoning:</strong>
            <div style="color: var(--muted); margin-top: 4px; line-height: 1.4;">
              ${threat.reasoning}
            </div>
          </div>
        ` : ''}
        
        ${threat.citations && threat.citations.length > 0 ? `
          <div style="margin-bottom: 12px;">
            <strong style="color: var(--text);">Sources & Citations:</strong>
            <div style="margin-top: 8px;">
              ${threat.citations.map(citation => `
                <div style="background: #0d1b34; border: 1px solid #223056; border-radius: 6px; padding: 12px; margin-bottom: 8px;">
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                    <div style="flex: 1;">
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <span style="background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">
                          ${citation.platform.toUpperCase()}
                        </span>
                        ${citation.relevance_score ? `
                          <span style="color: var(--muted); font-size: 11px;">
                            ${(citation.relevance_score * 100).toFixed(0)}% relevant
                          </span>
                        ` : ''}
                      </div>
                      ${citation.title ? `
                        <div style="font-weight: 600; color: var(--text); margin-bottom: 4px;">
                          ${citation.title}
                        </div>
                      ` : ''}
                      ${citation.author ? `
                        <div style="color: var(--muted); font-size: 12px; margin-bottom: 4px;">
                          by ${citation.author}
                        </div>
                      ` : ''}
                      ${citation.content_preview ? `
                        <div style="color: var(--muted); font-size: 12px; line-height: 1.4; margin-bottom: 8px;">
                          "${citation.content_preview}"
                        </div>
                      ` : ''}
                      ${citation.timestamp ? `
                        <div style="color: var(--muted); font-size: 11px; margin-bottom: 8px;">
                          ${new Date(citation.timestamp).toLocaleString()}
                        </div>
                      ` : ''}
                    </div>
                  </div>
                  <div style="display: flex; justify-content: flex-end;">
                    <a href="${citation.url}" target="_blank" rel="noopener noreferrer" 
                       style="background: #3b82f6; color: white; padding: 6px 12px; border-radius: 4px; text-decoration: none; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15,3 21,3 21,9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                      </svg>
                      View Source
                    </a>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
  
  modal.className = 'modal';
  document.body.appendChild(modal);
}

function setupThreatControls() {
  // Status filter
  const statusFilter = q('#threat_status_filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      threatStatusFilter = e.target.value;
      loadThreats();
    });
  }
  
  // Level filter
  const levelFilter = q('#threat_level_filter');
  if (levelFilter) {
    levelFilter.addEventListener('change', (e) => {
      threatLevelFilter = e.target.value;
      loadThreats();
    });
  }
  
  // Refresh button
  const refreshBtn = q('#refresh_threats');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadThreats);
  }
  
  // Auto-refresh toggle
  const autoRefreshToggle = q('#threat_auto_refresh');
  if (autoRefreshToggle) {
    autoRefreshToggle.addEventListener('change', (e) => {
      threatAutoRefresh = e.target.checked;
      if (threatAutoRefresh) {
        startThreatAutoRefresh();
      } else {
        stopThreatAutoRefresh();
      }
    });
  }
}

function startThreatAutoRefresh() {
  if (threatRefreshInterval) {
    clearInterval(threatRefreshInterval);
  }
  threatRefreshInterval = setInterval(loadThreats, 30000); // Refresh every 30 seconds
}

function stopThreatAutoRefresh() {
  if (threatRefreshInterval) {
    clearInterval(threatRefreshInterval);
    threatRefreshInterval = null;
  }
}

// WebSocket event handlers for threats
function handleNewThreatDetected(data) {
  addActivityLog(`New ${data.threat_level} threat detected: ${data.threat_type || 'Unknown'}`, 'warning');
  
  // Show notification
  showMessage(`New ${data.threat_level} threat detected in ${data.geographical_area}`, 'warning', 8000);
  
  // Refresh threats list if we're viewing pending threats
  if (threatStatusFilter === 'pending' || threatStatusFilter === 'all') {
    loadThreats();
  }
}

function handleThreatAnnotationCreated(data) {
  addActivityLog(`Threat annotation created for ${data.threatLevel} threat`, 'success');
  
  // Refresh threats list
  loadThreats();
  
  // Refresh map data if available
  if (window.adminMap && window.adminMap.isAuthenticated()) {
    window.adminMap.loadMapData();
  }
}

function handleThreatDeleted(data) {
  addActivityLog(`Threat deleted: ${data.threatLevel} ${data.threatType}`, 'info');
  
  // Refresh threats list
  loadThreats();
}

function handleThreatUpdated(data) {
  addActivityLog(`Threat updated: ${data.threat_level} ${data.threat_type} (Update #${data.update_count})`, 'info');
  
  // Show notification with update reasoning
  const reasoning = data.update_reasoning ? data.update_reasoning.substring(0, 100) + '...' : 'No reasoning provided';
  showMessage(`Threat updated: ${data.threat_level} ${data.threat_type}`, 'info', 5000);
  
  // Refresh threats list
  loadThreats();
}

// WebSocket connection management
function connectWebSocket() {
  // Check if Socket.IO library is loaded first
  if (typeof io === 'undefined') {
    console.error('Socket.IO library not loaded');
    addActivityLog('Socket.IO library not loaded - check network connection', 'error');
    return;
  }
  
  // Prevent multiple simultaneous connections
  if (socket && socket.connected) {
    console.log('WebSocket already connected, skipping new connection');
    return;
  }
  
  // Clean up any existing connection first
  if (socket) {
    console.log('Cleaning up existing WebSocket connection');
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch (e) {
      console.log('Error during socket cleanup:', e);
    }
    socket = null;
    window.socket = null;
  }
  
  if (!token) {
    console.log('No authentication token available, skipping WebSocket connection');
    addActivityLog('No authentication token - login required', 'warning');
    return;
  }
  
  try {
    console.log('Attempting WebSocket connection with token:', token.substring(0, 10) + '...');
    socket = io({
      auth: { token: token },
      transports: ['websocket', 'polling'],
      // Disable auto-reconnection to prevent connection leaks
      reconnection: false,
      // Set connection timeout
      timeout: 10000
    });
    
    // Make socket globally available for other components
    window.socket = socket;
    
    socket.on('connect', () => {
      console.log('Admin WebSocket connected');
      addActivityLog('WebSocket connected', 'success');
      reconnectAttempts = 0; // Reset on successful connection
      updateWebSocketStatus('Connected', '#22c55e');
      
      // Emit custom event for other components to listen to
      document.dispatchEvent(new CustomEvent('socketConnected'));
    });
    
    socket.on('disconnect', (reason) => {
      console.log('Admin WebSocket disconnected:', reason);
      addActivityLog(`WebSocket disconnected: ${reason}`, 'warning');
      updateWebSocketStatus('Disconnected', '#ef4444');
      
      // Emit custom event for other components to listen to
      document.dispatchEvent(new CustomEvent('socketDisconnected'));
      
      // Auto-reconnect on unexpected disconnections
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, don't auto-reconnect
        addActivityLog('Server disconnected - manual reconnection required', 'error');
      } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        updateWebSocketStatus('Reconnecting...', '#f59e0b');
        setTimeout(() => {
          reconnectAttempts++;
          addActivityLog(`Attempting reconnection ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`, 'info');
          connectWebSocket();
        }, 2000 * reconnectAttempts); // Exponential backoff
      }
    });
    
    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Connection failed';
      if (error.message) {
        errorMessage = error.message;
      } else if (error.type === 'TransportError') {
        errorMessage = 'Network connection failed';
      } else if (error.type === 'UnauthorizedError') {
        errorMessage = 'Authentication failed - please login again';
      }
      
      addActivityLog(`Connection error: ${errorMessage}`, 'error');
      
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(() => {
          reconnectAttempts++;
          addActivityLog(`Retrying connection ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`, 'info');
          connectWebSocket();
        }, 3000 * reconnectAttempts);
      } else {
        addActivityLog('Max reconnection attempts reached', 'error');
      }
    });
    
    // Listen for real-time updates
    socket.on('admin:stats_update', (stats) => {
      updateStatsDisplay(stats);
      addActivityLog('Stats updated', 'info');
    });
    
    socket.on('admin:connection_update', (data) => {
      updateConnectionsDisplay(data);
      addActivityLog(`Connection update: ${data.type}`, 'info');
    });
    
    socket.on('admin:sync_activity', (data) => {
      addActivityLog(`Sync: ${data.type} - ${data.details}`, 'info');
    });
    
    // Listen for message events
    socket.on('admin:message_received', (data) => {
      handleMessageReceived(data);
    });
    
    // Listen for new threat events
    socket.on('admin:new_threat_detected', (data) => {
      handleNewThreatDetected(data);
    });
    
    // Listen for threat annotation created events
    socket.on('admin:threat_annotation_created', (data) => {
      handleThreatAnnotationCreated(data);
    });
    
    // Listen for threat deleted events
    socket.on('admin:threat_deleted', (data) => {
      handleThreatDeleted(data);
    });
    
    socket.on('admin:threat_updated', (data) => {
      handleThreatUpdated(data);
    });
    
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
    addActivityLog(`WebSocket setup failed: ${error.message}`, 'error');
  }
}

function disconnectWebSocket() {
  if (socket) {
    console.log('Disconnecting WebSocket:', socket.id);
    try {
      // Remove all event listeners to prevent memory leaks
      socket.removeAllListeners();
      socket.disconnect();
    } catch (e) {
      console.log('Error during socket disconnect:', e);
    }
    socket = null;
    window.socket = null;
  }
  updateWebSocketStatus('Disconnected', '#ef4444');
}

// Update WebSocket status display
function updateWebSocketStatus(status, color) {
  const statusEl = q('#ws_status');
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.style.color = color;
  }
}

// Initialize WebSocket status on page load
document.addEventListener('DOMContentLoaded', () => {
  updateWebSocketStatus('Disconnected', '#ef4444');
  
  // Wait for Socket.IO library to load
  waitForSocketIO();
});

// Cleanup WebSocket connections when page is unloaded
window.addEventListener('beforeunload', () => {
  console.log('Page unloading - cleaning up WebSocket connections');
  disconnectWebSocket();
});

// Also cleanup on page hide (mobile browsers, tab switching)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    console.log('Page hidden - disconnecting WebSocket to prevent leaks');
    disconnectWebSocket();
  } else if (document.visibilityState === 'visible' && token) {
    console.log('Page visible - reconnecting WebSocket');
    // Small delay to avoid rapid reconnection
    setTimeout(() => {
      if (token && !socket) {
        connectWebSocket();
      }
    }, 1000);
  }
});

// Wait for Socket.IO library to be available
function waitForSocketIO() {
  if (typeof io !== 'undefined') {
    console.log('Socket.IO library is available');
    // If we're already logged in, try to connect WebSocket
    if (token) {
      connectWebSocket();
    }
  } else {
    console.log('Waiting for Socket.IO library...');
    updateWebSocketStatus('Loading Library...', '#f59e0b');
    setTimeout(waitForSocketIO, 100);
  }
}

// Enhanced message display system
function showMessage(message, type = 'info', duration = 5000) {
  const msgEl = q('#globalMessage');
  if (!msgEl) return;
  
  msgEl.textContent = message;
  msgEl.className = `message message-${type}`;
  msgEl.classList.remove('hidden');
  
  if (duration > 0) {
    setTimeout(() => {
      msgEl.classList.add('fade-out');
      setTimeout(() => msgEl.classList.add('hidden'), 300);
    }, duration);
  }
}

function showFieldMessage(fieldId, message, type = 'info') {
  const msgEl = q(`#${fieldId}`);
  if (!msgEl) return;
  
  msgEl.textContent = message;
  msgEl.className = `message message-${type}`;
  msgEl.classList.remove('hidden');
}

function hideFieldMessage(fieldId) {
  const msgEl = q(`#${fieldId}`);
  if (msgEl) {
    msgEl.classList.add('hidden');
  }
}

// Enhanced HTTP functions with better error handling
function hdrs(add={}) { 
  const h = { 'Content-Type':'application/json' }; 
  if (token) h['Authorization'] = 'Bearer '+token; 
  return Object.assign(h, add); 
}

async function jget(url, opts={}) {
  try {
    const res = await fetch(url, Object.assign({ headers: hdrs(), credentials: 'include' }, opts));
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(errorData.error || `Request failed with status ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error('Request failed:', error);
    throw error;
  }
}

// Loading state management
function setLoading(loading = true) {
  const buttons = document.querySelectorAll('button');
  buttons.forEach(btn => {
    if (loading) {
      btn.classList.add('loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

// Page navigation
let currentPage = 'dashboard';

function showPage(pageName) {
  // Hide all pages
  const pages = ['dash', 'settingsPage', 'managementPage', 'threatsPage', 'messagesPage'];
  pages.forEach(page => {
    const el = q(`#${page}`);
    if (el) el.classList.add('hidden');
  });
  
  // Show selected page
  const pageMap = {
    'dashboard': 'dash',
    'settings': 'settingsPage',
    'management': 'managementPage',
    'threats': 'threatsPage',
    'messages': 'messagesPage'
  };
  
  const pageId = pageMap[pageName];
  if (pageId) {
    const el = q(`#${pageId}`);
    if (el) el.classList.remove('hidden');
  }
  
  // Update navigation highlighting
  const navLinks = ['nav-dashboard', 'nav-settings', 'nav-management', 'nav-threats', 'nav-messages', 'nav-social'];
  navLinks.forEach(linkId => {
    const link = q(`#${linkId}`);
    if (link) {
      const isActive = (pageName === 'dashboard' && linkId === 'nav-dashboard') ||
                       (pageName === 'settings' && linkId === 'nav-settings') ||
                       (pageName === 'management' && linkId === 'nav-management') ||
                       (pageName === 'threats' && linkId === 'nav-threats') ||
                       (pageName === 'messages' && linkId === 'nav-messages');
      
      if (isActive) {
        link.style.background = 'var(--accent)';
        link.style.color = 'var(--text)';
      } else {
        link.style.background = 'transparent';
        link.style.color = 'var(--muted)';
      }
    }
  });
  
  currentPage = pageName;
  
  // Initialize page-specific features
  if (pageName === 'dashboard' || pageName === 'threats') {
    if (threatsList.length === 0) {
      loadThreats();
    }
    if (threatAutoRefresh) {
      startThreatAutoRefresh();
    }
  }
  
  if (pageName === 'dashboard' || pageName === 'messages') {
    updateMessageDisplay();
  }
}

function showDash(show) {
  q('#loginCard').classList.toggle('hidden', show);
  q('#logout').classList.toggle('hidden', !show);
  q('#who').classList.toggle('hidden', !show);
  q('#adminNav').classList.toggle('hidden', !show);
  
  if (show) {
    // Initialize message monitoring controls
    setupMessageControls();
    
    // Initialize threat review controls
    setupThreatControls();
    
    // Show dashboard by default
    showPage('dashboard');
    
    // Wait for Socket.IO library if not available, then connect
    if (typeof io !== 'undefined') {
      // Add a small delay to ensure authentication is fully processed
      setTimeout(() => {
        connectWebSocket();
      }, 100);
    } else {
      console.log('Socket.IO not ready, waiting...');
      updateWebSocketStatus('Loading Library...', '#f59e0b');
      waitForSocketIO();
    }
  } else {
    disconnectWebSocket();
    stopThreatAutoRefresh();
  }
}

// Real-time stats update function
function updateStatsDisplay(stats) {
  if (!stats) return;
  
  // Update operational status bar (field operations focus)
  if (stats.db) {
    const usersEl = q('#k_users');
    if (usersEl) {
      usersEl.textContent = stats.db.users ?? '-';
    }
    
    const teamsEl = q('#k_teams');
    if (teamsEl) {
      teamsEl.textContent = stats.db.teams ?? '-';
    }
  }
  
  // Update sync status
  const totalConnections = stats.sockets?.totalConnections || 0;
  const authConnections = stats.sockets?.authenticatedConnections || 0;
  const syncStatusEl = q('#k_sync_status');
  if (syncStatusEl) {
    if (totalConnections > 0) {
      const syncStatus = authConnections > 0 ? 'Active' : 'Inactive';
      syncStatusEl.textContent = syncStatus;
      syncStatusEl.style.color = authConnections > 0 ? '#22c55e' : '#ef4444';
    } else {
      syncStatusEl.textContent = 'Offline';
      syncStatusEl.style.color = '#8b97a7';
    }
  }
  
  // Update active threats count (will be updated by updateActiveThreatsPanel)
  updateActiveThreatsPanel();
  
  // Update recent messages count
  const recentMessagesCount = q('#k_recent_messages');
  if (recentMessagesCount) {
    const teamFilter = q('#message_team_filter_compact')?.value || '';
    const filteredCount = teamFilter 
      ? messageLog.filter(msg => msg.teamId === teamFilter).length
      : messageLog.length;
    recentMessagesCount.textContent = filteredCount;
  }
}

// Real-time connections update function
function updateConnectionsDisplay(data) {
  if (!data) return;
  
  const roomsData = data.rooms || {};
  const allRoomsData = data.allRooms || {};
  
  // Show team rooms (original behavior)
  if (Object.keys(roomsData).length > 0) {
    const formattedRooms = Object.entries(roomsData)
      .map(([room, count]) => `${room}: ${count} connections`)
      .join('\n');
    q('#rooms').textContent = formattedRooms;
  } else {
    // Show debugging info when no team rooms
    const totalConnections = data.totalConnections || 0;
    const authConnections = data.authenticatedConnections || 0;
    
    if (totalConnections > 0) {
      let debugInfo = `Total connections: ${totalConnections}\n`;
      debugInfo += `Authenticated: ${authConnections}\n\n`;
      
      if (Object.keys(allRoomsData).length > 0) {
        debugInfo += 'All rooms:\n';
        debugInfo += Object.entries(allRoomsData)
          .map(([room, count]) => `  ${room}: ${count}`)
          .join('\n');
      } else {
        debugInfo += 'No rooms found';
      }
      
      q('#rooms').textContent = debugInfo;
    } else {
      q('#rooms').textContent = 'No active connections';
    }
  }
}

async function refresh() {
  try {
    setLoading(true);
    const [cfg, stats, teams, users, version] = await Promise.all([
      jget('/api/admin/config'),
      jget('/api/admin/stats'),
      jget('/api/admin/teams'),
      jget('/api/admin/users'),
      jget('/api/admin/version')
    ]);
    
    // Update configuration fields
    q('#org').value = cfg.orgName || '';
    q('#cors').value = cfg.corsOrigin || '';
    q('#retention').value = cfg.retentionDays || 0;
    
    // Update stats using real-time function
    updateStatsDisplay(stats);
    updateConnectionsDisplay(stats.sockets);
    
    // Update version display in header
    if (version) {
      q('#header_version').textContent = version.version || '-';
    }

    // Populate users table
    const utb = q('#u_table tbody'); 
    utb.innerHTML = '';
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${u.email}</td><td>${u.name || ''}</td><td>${u.is_admin ? 'Yes' : 'No'}</td><td>
        <button data-act="reset" data-id="${u.id}" class="secondary">Reset PW</button>
        <button data-act="del" data-id="${u.id}" class="secondary">Delete</button>
      </td>`;
      utb.appendChild(tr);
    });

    // Populate teams select and table
    const tsel = q('#t_select'); 
    tsel.innerHTML = '';
    teams.forEach(t => { 
      const o = document.createElement('option'); 
      o.value = t.id; 
      o.textContent = t.name; 
      tsel.appendChild(o); 
    });
    
    // Populate message team filter (full monitor)
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
    
    // Populate message team filter (compact monitor)
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
    
    const usel = q('#t_user_select'); 
    usel.innerHTML = '';
    users.forEach(u => { 
      const o = document.createElement('option'); 
      o.value = u.id; 
      o.textContent = `${u.name || ''} <${u.email}>`; 
      usel.appendChild(o); 
    });
    
    if (teams[0]) await loadTeamMembers(teams[0].id);
    
    showMessage('Dashboard refreshed successfully', 'success', 3000);
  } catch (e) { 
    console.error('Refresh failed:', e);
    showMessage(`Failed to refresh dashboard: ${e.message}`, 'error');
    showDash(false);
  } finally {
    setLoading(false);
  }
}

async function loadTeamMembers(teamId) {
  try {
    const members = await jget(`/api/admin/teams/${teamId}/members`);
    const tb = q('#t_table tbody'); 
    tb.innerHTML = '';
    
    if (members.length === 0) {
      tb.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--muted);">No members in this team</td></tr>';
      return;
    }
    
    members.forEach(m => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${m.name || ''}</td><td>${m.email}</td><td>
        <button data-act="kick" data-uid="${m.id}" class="secondary">Remove</button>
      </td>`;
      tb.appendChild(tr);
    });
  } catch (error) {
    console.error('Failed to load team members:', error);
    showMessage(`Failed to load team members: ${error.message}`, 'error');
  }
}

// Enhanced login with better error handling
q('#login').onclick = async () => {
  try {
    setLoading(true);
    hideFieldMessage('loginMsg');
    
    const email = q('#email').value.trim();
    const password = q('#password').value;
    
    if (!email || !password) {
      showFieldMessage('loginMsg', 'Please enter both email and password', 'error');
      return;
    }
    
    const res = await fetch('/api/auth/login?cookie=1', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ email, password }) 
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(errorData.error || 'Invalid email or password');
    }
    
    const data = await res.json();
    token = data.token; 
    localStorage.setItem('taklite:token', token);
    q('#who').textContent = email;
    showDash(true);
    await refresh();
    
    // Refresh map data if map is initialized
    if (window.adminMap && window.adminMap.isAuthenticated()) {
      await window.adminMap.loadTeams();
      await window.adminMap.loadMapData();
    }
    
    showMessage('Login successful!', 'success', 3000);
  } catch (e) { 
    console.error('Login failed:', e);
    showFieldMessage('loginMsg', e.message || 'Login failed. Please check your credentials.', 'error');
  } finally {
    setLoading(false);
  }
};

q('#logout').onclick = async () => { 
  try { 
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); 
  } catch (e) {
    console.error('Logout error:', e);
  }
  token = ''; 
  localStorage.removeItem('taklite:token'); 
  disconnectWebSocket();
  showDash(false);
  showMessage('Logged out successfully', 'info', 3000);
};

// Manual WebSocket reconnection
const reconnectBtn = q('#reconnect_ws');
if (reconnectBtn) {
  reconnectBtn.onclick = () => {
    addActivityLog('Manual reconnection requested', 'info');
    reconnectAttempts = 0; // Reset attempts for manual reconnect
    
    if (typeof io !== 'undefined') {
      connectWebSocket();
    } else {
      console.log('Socket.IO not ready, waiting...');
      updateWebSocketStatus('Loading Library...', '#f59e0b');
      waitForSocketIO();
    }
  };
}

// Enhanced save configuration with validation
q('#save').onclick = async () => {
  try {
    setLoading(true);
    hideFieldMessage('saveMsg');
    
    const orgName = q('#org').value.trim();
    const corsOrigin = q('#cors').value.trim();
    const retentionDays = Number(q('#retention').value || 0);
    
    if (!orgName) {
      showFieldMessage('saveMsg', 'Organization name is required', 'error');
      return;
    }
    
    if (retentionDays < 0 || retentionDays > 365) {
      showFieldMessage('saveMsg', 'Retention days must be between 0 and 365', 'error');
      return;
    }
    
    await fetch('/api/admin/config', { 
      method: 'PUT', 
      headers: hdrs(), 
      body: JSON.stringify({ orgName, corsOrigin, retentionDays }) 
    });
    
    showFieldMessage('saveMsg', 'Configuration saved successfully!', 'success');
    showMessage('Configuration updated', 'success', 3000);
  } catch (e) {
    console.error('Save failed:', e);
    showFieldMessage('saveMsg', `Failed to save: ${e.message}`, 'error');
  } finally {
    setLoading(false);
  }
};

// Enhanced user creation with validation
q('#u_create').onclick = async () => {
  try {
    setLoading(true);
    hideFieldMessage('u_msg');
    
    const email = q('#u_email').value.trim();
    const name = q('#u_name').value.trim();
    const isAdmin = q('#u_admin').checked;
    
    if (!email || !name) {
      showFieldMessage('u_msg', 'Email and name are required', 'error');
      return;
    }
    
    if (!email.includes('@')) {
      showFieldMessage('u_msg', 'Please enter a valid email address', 'error');
      return;
    }
    
    const body = { email, name, is_admin: isAdmin };
    const res = await fetch('/api/admin/users', { method: 'POST', headers: hdrs(), body: JSON.stringify(body) });
    const data = await res.json(); 
    
    if (!res.ok) throw new Error(data.error || 'Failed to create user');
    
    showFieldMessage('u_msg', `User created successfully! Temporary password: ${data.password}`, 'success');
    showMessage('User created', 'success', 5000);
    
    // Clear form
    q('#u_email').value = '';
    q('#u_name').value = '';
    q('#u_admin').checked = false;
    
    await refresh();
  } catch (e) {
    console.error('User creation failed:', e);
    showFieldMessage('u_msg', `Failed to create user: ${e.message}`, 'error');
  } finally {
    setLoading(false);
  }
};

// Enhanced user table actions with confirmation
q('#u_table').onclick = async (ev) => {
  const btn = ev.target.closest('button'); 
  if (!btn) return;
  
  const id = btn.getAttribute('data-id'); 
  const act = btn.getAttribute('data-act');
  
  if (act === 'reset') {
    if (!confirm('Are you sure you want to reset this user\'s password? They will need to set a new password on their next login.')) {
      return;
    }
    
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users/${id}/reset-password`, { method: 'POST', headers: hdrs() });
      const data = await res.json(); 
      
      if (!res.ok) throw new Error(data.error || 'Password reset failed');
      
      alert(`Password reset successfully! New password: ${data.password}`);
      showMessage('Password reset successfully', 'success', 5000);
    } catch (e) {
      console.error('Password reset failed:', e);
      alert(`Password reset failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  } else if (act === 'del') {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }
    
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE', headers: hdrs() });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Delete failed' }));
        throw new Error(errorData.error || 'Delete failed');
      }
      
      showMessage('User deleted successfully', 'success', 3000);
      await refresh();
    } catch (e) {
      console.error('User deletion failed:', e);
      alert(`Failed to delete user: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }
};

// Enhanced team creation with validation
q('#t_create').onclick = async () => {
  try {
    setLoading(true);
    hideFieldMessage('t_msg');
    
    const name = q('#t_name').value.trim();
    
    if (!name) {
      showFieldMessage('t_msg', 'Team name is required', 'error');
      return;
    }
    
    const res = await fetch('/api/admin/teams', { method: 'POST', headers: hdrs(), body: JSON.stringify({ name }) }); 
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Team creation failed' }));
      throw new Error(errorData.error || 'Team creation failed');
    }
    
    showFieldMessage('t_msg', 'Team created successfully!', 'success');
    showMessage('Team created', 'success', 3000);
    
    // Clear form
    q('#t_name').value = '';
    
    await refresh();
  } catch (e) {
    console.error('Team creation failed:', e);
    showFieldMessage('t_msg', `Failed to create team: ${e.message}`, 'error');
  } finally {
    setLoading(false);
  }
};

// Enhanced team member addition with validation
q('#t_add_member').onclick = async () => {
  try {
    setLoading(true);
    hideFieldMessage('t_msg');
    
    const teamId = q('#t_select').value; 
    const userId = q('#t_user_select').value;
    
    if (!teamId || !userId) {
      showFieldMessage('t_msg', 'Please select both a team and a user', 'error');
      return;
    }
    
    const res = await fetch(`/api/admin/teams/${teamId}/members`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ userId }) }); 
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Failed to add member' }));
      throw new Error(errorData.error || 'Failed to add member');
    }
    
    showFieldMessage('t_msg', 'Member added successfully!', 'success');
    showMessage('Team member added', 'success', 3000);
    
    await loadTeamMembers(teamId);
  } catch (e) {
    console.error('Add member failed:', e);
    showFieldMessage('t_msg', `Failed to add member: ${e.message}`, 'error');
  } finally {
    setLoading(false);
  }
};

q('#t_select').onchange = () => loadTeamMembers(q('#t_select').value);

// Try to check if user is already authenticated via cookies
async function checkExistingAuth() {
  try {
    // First check if we have a token in localStorage (from setup)
    const storedToken = localStorage.getItem('taklite:token');
    if (storedToken) {
      token = storedToken;
      // Try to validate the token by making a request
      try {
        const res = await fetch('/api/auth/whoami', { 
          method: 'GET', 
          headers: { 'Authorization': `Bearer ${storedToken}` }
        });
        
        if (res.ok) {
          const userData = await res.json();
          q('#who').textContent = userData.email || 'Admin User';
          showDash(true);
          
          // Try to refresh the dashboard
          try {
            await refresh();
            
            // Refresh map data if map is initialized
            if (window.adminMap && window.adminMap.isAuthenticated()) {
              await window.adminMap.loadTeams();
              await window.adminMap.loadMapData();
            }
            
            showMessage('Welcome back!', 'success', 3000);
          } catch (refreshError) {
            console.log('Dashboard refresh failed, but user is authenticated:', refreshError);
            showMessage('Dashboard loaded', 'info', 2000);
          }
          
          return true;
        }
      } catch (e) {
        console.log('Stored token validation failed, trying cookies');
        // Token failed, remove it and try cookies
        localStorage.removeItem('taklite:token');
        token = '';
      }
    }
    
    // Try to get user info using existing cookies
    const res = await fetch('/api/auth/whoami', { 
      method: 'GET', 
      credentials: 'include' // Include cookies
    });
    
    if (res.ok) {
      const userData = await res.json();
      // User is already authenticated
      q('#who').textContent = userData.email || 'Admin User';
      showDash(true);
      
      // Try to refresh the dashboard
      try {
        await refresh();
        
        // Refresh map data if map is initialized
        if (window.adminMap && window.adminMap.isAuthenticated()) {
          await window.adminMap.loadTeams();
          await window.adminMap.loadMapData();
        }
        
        showMessage('Welcome back!', 'success', 3000);
      } catch (refreshError) {
        console.log('Dashboard refresh failed, but user is authenticated:', refreshError);
        // User is authenticated but dashboard refresh failed - this is okay
        showMessage('Dashboard loaded', 'info', 2000);
      }
      
      return true;
    }
  } catch (e) {
    console.log('No existing authentication found');
  }
  
  // No existing auth, show login form
  showDash(false);
  return false;
}

// Setup navigation links
document.addEventListener('DOMContentLoaded', () => {
  // Navigation link handlers
  const navLinks = {
    'nav-dashboard': () => showPage('dashboard'),
    'nav-settings': () => showPage('settings'),
    'nav-management': () => showPage('management'),
    'nav-threats': () => showPage('threats'),
    'nav-messages': () => showPage('messages')
  };
  
  Object.entries(navLinks).forEach(([id, handler]) => {
    const link = q(`#${id}`);
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        handler();
      });
    }
  });
  
  // Handle browser back/forward
  window.addEventListener('popstate', (e) => {
    const page = e.state?.page || 'dashboard';
    showPage(page);
  });
  
  // Check URL hash for initial page
  const hash = window.location.hash.substring(1);
  if (hash && ['dashboard', 'settings', 'management', 'threats', 'messages'].includes(hash)) {
    showPage(hash);
  }
});

// Initialize the interface
checkExistingAuth();


