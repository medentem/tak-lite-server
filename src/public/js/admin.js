let token = localStorage.getItem('taklite:token') || '';
const q = (s)=>document.querySelector(s);
function hdrs(add={}) { const h = { 'Content-Type':'application/json' }; if (token) h['Authorization'] = 'Bearer '+token; return Object.assign(h, add); }
async function jget(url, opts={}) {
  const res = await fetch(url, Object.assign({ headers: hdrs(), credentials: 'include' }, opts));
  if (!res.ok) throw await res.json().catch(()=>({error:res.status}));
  return res.json();
}
function showDash(show) {
  q('#loginCard').classList.toggle('hidden', show);
  q('#dash').classList.toggle('hidden', !show);
  q('#logout').classList.toggle('hidden', !show);
  q('#who').classList.toggle('hidden', !show);
}
async function refresh() {
  try {
    const [cfg, stats, teams, users] = await Promise.all([
      jget('/api/admin/config'),
      jget('/api/admin/stats'),
      jget('/api/admin/teams'),
      jget('/api/admin/users')
    ]);
    q('#org').value = cfg.orgName || '';
    q('#cors').value = cfg.corsOrigin || '';
    q('#retention').value = cfg.retentionDays || 0;
    q('#k_users').textContent = stats.db.users ?? '-';
    q('#k_teams').textContent = stats.db.teams ?? '-';
    q('#k_sockets').textContent = stats.sockets.totalConnections ?? 0;
    q('#k_auth').textContent = stats.sockets.authenticatedConnections ?? 0;
    q('#k_uptime').textContent = stats.server.uptimeSec + 's';
    q('#k_node').textContent = stats.server.node;
    q('#k_load').textContent = (stats.server.loadavg||[]).map(n=>n.toFixed(2)).join(' / ');
    q('#k_mem').textContent = (stats.server.memory.heapUsed/1048576).toFixed(1)+' MB';
    q('#rooms').textContent = JSON.stringify(stats.sockets.rooms, null, 2);

    // Populate users table
    const utb = q('#u_table tbody'); utb.innerHTML='';
    users.forEach(u=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${u.email}</td><td>${u.name||''}</td><td>${u.is_admin?'Yes':'No'}</td><td>
        <button data-act="reset" data-id="${u.id}" class="secondary">Reset PW</button>
        <button data-act="del" data-id="${u.id}" class="secondary">Delete</button>
      </td>`;
      utb.appendChild(tr);
    });

    // Populate teams select and table
    const tsel = q('#t_select'); tsel.innerHTML='';
    teams.forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; tsel.appendChild(o); });
    const usel = q('#t_user_select'); usel.innerHTML='';
    users.forEach(u=>{ const o=document.createElement('option'); o.value=u.id; o.textContent=`${u.name||''} <${u.email}>`; usel.appendChild(o); });
    if (teams[0]) await loadTeamMembers(teams[0].id);
  } catch (e) { console.error(e); showDash(false); }
}

async function loadTeamMembers(teamId){
  const members = await jget(`/api/admin/teams/${teamId}/members`);
  const tb = q('#t_table tbody'); tb.innerHTML='';
  members.forEach(m=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${m.name||''}</td><td>${m.email}</td><td>
      <button data-act="kick" data-uid="${m.id}" class="secondary">Remove</button>
    </td>`;
    tb.appendChild(tr);
  });
}

q('#login').onclick = async () => {
  try {
    const res = await fetch('/api/auth/login?cookie=1', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email:q('#email').value, password:q('#password').value }) });
    if (!res.ok) throw await res.json().catch(()=>({error:res.status}));
    const data = await res.json();
    token = data.token; localStorage.setItem('taklite:token', token);
    q('#who').textContent = q('#email').value;
    showDash(true);
    refresh();
  } catch (e) { q('#loginMsg').textContent = 'Login failed'; }
};
q('#logout').onclick = async () => { try { await fetch('/api/auth/logout', { method:'POST', credentials:'include' }); } catch {} token=''; localStorage.removeItem('taklite:token'); showDash(false); };
q('#save').onclick = async () => {
  try { await fetch('/api/admin/config', { method:'PUT', headers: hdrs(), body: JSON.stringify({ orgName:q('#org').value, corsOrigin:q('#cors').value, retentionDays: Number(q('#retention').value||0) }) }); q('#saveMsg').textContent='Saved'; }
  catch { q('#saveMsg').textContent='Save failed'; }
};

// Users create
q('#u_create').onclick = async () => {
  try {
    const body = { email:q('#u_email').value, name:q('#u_name').value, is_admin:q('#u_admin').checked };
    const res = await fetch('/api/admin/users', { method:'POST', headers: hdrs(), body: JSON.stringify(body) });
    const data = await res.json(); if(!res.ok) throw data;
    q('#u_msg').textContent = `Created. Temporary password: ${data.password}`;
    await refresh();
  } catch(e){ q('#u_msg').textContent = 'Create failed'; }
};

// Delegate table actions for users
q('#u_table').onclick = async (ev)=>{
  const btn = ev.target.closest('button'); if(!btn) return;
  const id = btn.getAttribute('data-id'); const act = btn.getAttribute('data-act');
  if (act==='reset') {
    const res = await fetch(`/api/admin/users/${id}/reset-password`, { method:'POST', headers: hdrs() });
    const data = await res.json(); if(!res.ok) return alert('Reset failed');
    alert('New password: '+data.password);
  } else if (act==='del') {
    await fetch(`/api/admin/users/${id}`, { method:'DELETE', headers: hdrs() });
    await refresh();
  }
};

// Teams create and membership
q('#t_create').onclick = async ()=>{
  try { const res = await fetch('/api/admin/teams', { method:'POST', headers: hdrs(), body: JSON.stringify({ name:q('#t_name').value }) }); if(!res.ok) throw 0; await refresh(); }
  catch { q('#t_msg').textContent='Create failed'; }
};
q('#t_add_member').onclick = async ()=>{
  const teamId = q('#t_select').value; const userId = q('#t_user_select').value;
  try { const res = await fetch(`/api/admin/teams/${teamId}/members`, { method:'POST', headers: hdrs(), body: JSON.stringify({ userId }) }); if(!res.ok) throw 0; await loadTeamMembers(teamId); }
  catch { q('#t_msg').textContent='Add failed'; }
};
q('#t_select').onchange = ()=> loadTeamMembers(q('#t_select').value);

// Try to refresh using cookie if available
refresh();


