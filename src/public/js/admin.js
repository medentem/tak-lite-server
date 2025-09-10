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
  // Team filter
  const teamFilter = q('#message_team_filter');
  if (teamFilter) {
    teamFilter.addEventListener('change', (e) => {
      messageTeamFilter = e.target.value || '';
      updateMessageDisplay();
    });
  }
  
  // Clear messages button
  const clearBtn = q('#clear_messages');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearMessages);
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
    socket.removeAllListeners();
    socket.disconnect();
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
    
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
    addActivityLog(`WebSocket setup failed: ${error.message}`, 'error');
  }
}

function disconnectWebSocket() {
  if (socket) {
    console.log('Disconnecting WebSocket:', socket.id);
    // Remove all event listeners to prevent memory leaks
    socket.removeAllListeners();
    socket.disconnect();
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

function showDash(show) {
  q('#loginCard').classList.toggle('hidden', show);
  q('#dash').classList.toggle('hidden', !show);
  q('#logout').classList.toggle('hidden', !show);
  q('#who').classList.toggle('hidden', !show);
  
  if (show) {
    // Initialize message monitoring controls
    setupMessageControls();
    
    // Wait for Socket.IO library if not available, then connect
    if (typeof io !== 'undefined') {
      connectWebSocket();
    } else {
      console.log('Socket.IO not ready, waiting...');
      updateWebSocketStatus('Loading Library...', '#f59e0b');
      waitForSocketIO();
    }
  } else {
    disconnectWebSocket();
  }
}

// Real-time stats update function
function updateStatsDisplay(stats) {
  if (!stats) return;
  
  // Update KPI values
  if (stats.db) {
    q('#k_users').textContent = stats.db.users ?? '-';
    q('#k_teams').textContent = stats.db.teams ?? '-';
    q('#k_annotations').textContent = stats.db.annotations ?? '-';
    q('#k_messages').textContent = stats.db.messages ?? '-';
    q('#k_locations').textContent = stats.db.locations ?? '-';
  }
  
  if (stats.sockets) {
    q('#k_sockets').textContent = stats.sockets.totalConnections ?? 0;
    q('#k_auth').textContent = stats.sockets.authenticatedConnections ?? 0;
  }
  
  if (stats.server) {
    q('#k_uptime').textContent = (stats.server.uptimeSec || 0) + 's';
    q('#k_node').textContent = stats.server.node || '-';
    
    // Handle load display - show alternative metrics for containerized environments
    if (stats.server.isContainerized && stats.server.alternativeMetrics) {
      const alt = stats.server.alternativeMetrics;
      const cpuUsage = alt.cpuUsage;
      const cpuPercent = ((cpuUsage.user + cpuUsage.system) / 1000000).toFixed(1); // Convert to seconds
      q('#k_load').textContent = `CPU: ${cpuPercent}s | Handles: ${alt.activeHandles}`;
    } else {
      q('#k_load').textContent = (stats.server.loadavg || []).map(n => n.toFixed(2)).join(' / ') || '-';
    }
    
    q('#k_mem').textContent = stats.server.memory?.heapUsed ? (stats.server.memory.heapUsed/1048576).toFixed(1)+' MB' : '-';
  }
  
  // Update sync status
  const totalConnections = stats.sockets?.totalConnections || 0;
  const authConnections = stats.sockets?.authenticatedConnections || 0;
  if (totalConnections > 0) {
    const syncStatus = authConnections > 0 ? 'Active' : 'Inactive';
    q('#k_sync_status').textContent = syncStatus;
    q('#k_sync_status').style.color = authConnections > 0 ? '#22c55e' : '#ef4444';
  } else {
    q('#k_sync_status').textContent = 'Offline';
    q('#k_sync_status').style.color = '#8b97a7';
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
    
    // Populate message team filter
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

// Initialize the interface
checkExistingAuth();


