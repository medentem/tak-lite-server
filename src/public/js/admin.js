let token = localStorage.getItem('taklite:token') || '';
const q = (s)=>document.querySelector(s);

// WebSocket connection for real-time updates
let socket = null;
let activityLog = [];
const MAX_ACTIVITY_ITEMS = 50;

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

// WebSocket connection management
function connectWebSocket() {
  if (socket) {
    socket.disconnect();
  }
  
  if (!token) return;
  
  try {
    socket = io({
      auth: { token: token },
      transports: ['websocket', 'polling']
    });
    
    socket.on('connect', () => {
      console.log('Admin WebSocket connected');
      addActivityLog('WebSocket connected', 'success');
    });
    
    socket.on('disconnect', () => {
      console.log('Admin WebSocket disconnected');
      addActivityLog('WebSocket disconnected', 'warning');
    });
    
    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      addActivityLog(`Connection error: ${error.message}`, 'error');
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
    
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
    addActivityLog(`WebSocket setup failed: ${error.message}`, 'error');
  }
}

function disconnectWebSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
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
    connectWebSocket();
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
    q('#k_load').textContent = (stats.server.loadavg || []).map(n => n.toFixed(2)).join(' / ') || '-';
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
  if (!data || !data.rooms) return;
  
  const roomsData = data.rooms;
  if (Object.keys(roomsData).length > 0) {
    const formattedRooms = Object.entries(roomsData)
      .map(([room, count]) => `${room}: ${count} connections`)
      .join('\n');
    q('#rooms').textContent = formattedRooms;
  } else {
    q('#rooms').textContent = 'No active connections';
  }
}

async function refresh() {
  try {
    setLoading(true);
    const [cfg, stats, teams, users] = await Promise.all([
      jget('/api/admin/config'),
      jget('/api/admin/stats'),
      jget('/api/admin/teams'),
      jget('/api/admin/users')
    ]);
    
    // Update configuration fields
    q('#org').value = cfg.orgName || '';
    q('#cors').value = cfg.corsOrigin || '';
    q('#retention').value = cfg.retentionDays || 0;
    
    // Update stats using real-time function
    updateStatsDisplay(stats);
    updateConnectionsDisplay(stats.sockets);

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


