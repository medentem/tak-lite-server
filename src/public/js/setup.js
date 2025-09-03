document.getElementById('submit').onclick = async () => {
  const submitBtn = document.getElementById('submit');
  const msgEl = document.getElementById('msg');
  
  try {
    // Show loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('loading');
    hideMessage();
    
    // Validate inputs
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const orgName = document.getElementById('org').value.trim();
    const corsOrigin = document.getElementById('cors').value.trim();
    
    if (!email || !password || !orgName) {
      showMessage('Please fill in all required fields', 'error');
      return;
    }
    
    if (password.length < 10) {
      showMessage('Password must be at least 10 characters long', 'error');
      return;
    }
    
    if (!email.includes('@')) {
      showMessage('Please enter a valid email address', 'error');
      return;
    }
    
    const payload = {
      adminEmail: email,
      adminPassword: password,
      orgName: orgName,
      corsOrigin: corsOrigin
    };
    
    const res = await fetch('/api/setup/complete', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(payload) 
    });
    
    if (res.ok) { 
      const data = await res.json();
      
      // Store authentication data for the admin interface
      if (data.token) {
        localStorage.setItem('taklite:token', data.token);
      }
      
      showMessage('Setup complete! Redirecting to admin panel...', 'success');
      
      // Redirect to admin page after a short delay to show the success message
      setTimeout(() => {
        window.location.href = '/admin';
      }, 2000);
    } else { 
      const e = await res.json().catch(() => ({ error: 'Setup failed' })); 
      showMessage(`Error: ${e.error || res.status}`, 'error'); 
    }
  } catch (error) {
    console.error('Setup failed:', error);
    showMessage(`Setup failed: ${error.message || 'Network error'}`, 'error');
  } finally {
    // Reset loading state
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
  }
};

function showMessage(message, type = 'info') {
  const msgEl = document.getElementById('msg');
  if (!msgEl) return;
  
  msgEl.textContent = message;
  msgEl.className = `message message-${type}`;
  msgEl.classList.remove('hidden');
}

function hideMessage() {
  const msgEl = document.getElementById('msg');
  if (msgEl) {
    msgEl.classList.add('hidden');
  }
}


