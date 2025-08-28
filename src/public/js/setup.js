document.getElementById('submit').onclick = async () => {
  const payload = {
    adminEmail: document.getElementById('email').value,
    adminPassword: document.getElementById('password').value,
    orgName: document.getElementById('org').value,
    corsOrigin: document.getElementById('cors').value
  };
  const res = await fetch('/api/setup/complete', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
  const msg = document.getElementById('msg');
  if (res.ok) { msg.innerText = 'Setup complete. You can now log in via /admin.'; }
  else { const e = await res.json().catch(()=>({error:'Failed'})); msg.innerText = 'Error: ' + (e.error || res.status); }
};


