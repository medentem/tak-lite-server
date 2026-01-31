/**
 * Management page module (Users & Teams)
 */

import { q, showMessage, showError, showSuccess } from '../utils/dom.js';
import { get, post, put, del } from '../utils/api.js';
import { escapeHtml } from '../utils/formatting.js';

export class ManagementPage {
  constructor() {
    this.initialized = false;
    this.users = [];
    this.teams = [];
  }

  init() {
    if (this.initialized) return;
    
    this.setupControls();
    this.loadData();
    this.initialized = true;
  }

  setupControls() {
    // User creation
    const createUserBtn = q('#u_create');
    if (createUserBtn) {
      createUserBtn.addEventListener('click', () => this.createUser());
    }

    // Copy password button
    const copyPwBtn = q('#u_password_copy');
    if (copyPwBtn) {
      copyPwBtn.addEventListener('click', () => this.copyPassword());
    }

    // Team creation
    const createTeamBtn = q('#t_create');
    if (createTeamBtn) {
      createTeamBtn.addEventListener('click', () => this.createTeam());
    }

    // Add team member
    const addMemberBtn = q('#t_add_member');
    if (addMemberBtn) {
      addMemberBtn.addEventListener('click', () => this.addTeamMember());
    }

    // Team selection
    const teamSelect = q('#t_select');
    if (teamSelect) {
      teamSelect.addEventListener('change', (e) => {
        this.loadTeamMembers(e.target.value);
      });
    }

    // User table actions
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;

      const action = btn.dataset.act;
      const id = btn.dataset.id || btn.dataset.uid;

      if (action === 'edit') {
        this.showEditUserModal(id);
      } else if (action === 'reset') {
        this.resetUserPassword(id);
      } else if (action === 'del') {
        this.deleteUser(id);
      } else if (action === 'kick') {
        this.removeTeamMember(id);
      }
    });
  }

  showEditUserModal(userId) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) return;
    const existing = document.getElementById('user-edit-modal');
    if (existing) existing.remove();
    const modalHtml = `
      <div id="user-edit-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.7); z-index: 10000; display: flex; align-items: center; justify-content: center;">
        <div class="card" style="min-width: 320px; max-width: 420px;">
          <h3 style="margin-top: 0;">Edit User</h3>
          <div class="field-group">
            <label for="user-edit-name">Username</label>
            <input type="text" id="user-edit-name" value="${escapeHtml(user.name)}" />
          </div>
          <div class="field-group">
            <label for="user-edit-email">Email (optional)</label>
            <input type="email" id="user-edit-email" value="${user.email ? escapeHtml(user.email) : ''}" placeholder="Optional" />
          </div>
          <div class="field-group" style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="user-edit-admin" ${user.is_admin ? 'checked' : ''} />
            <label for="user-edit-admin" style="margin: 0;">Administrator</label>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button type="button" id="user-edit-cancel" class="secondary">Cancel</button>
            <button type="button" id="user-edit-save" class="primary">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modal = document.getElementById('user-edit-modal');
    const cancelBtn = document.getElementById('user-edit-cancel');
    const saveBtn = document.getElementById('user-edit-save');
    const closeModal = () => {
      if (modal) modal.remove();
    };
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    saveBtn.addEventListener('click', () => {
      this.saveUserEdit(userId, closeModal);
    });
  }

  async saveUserEdit(userId, closeModal) {
    try {
      const name = q('#user-edit-name')?.value.trim();
      const email = q('#user-edit-email')?.value.trim();
      const isAdmin = q('#user-edit-admin')?.checked ?? false;
      if (!name) {
        showError('Username is required');
        return;
      }
      await put(`/api/admin/users/${userId}`, {
        name,
        email: email || null,
        is_admin: isAdmin
      });
      showSuccess('User updated');
      closeModal();
      await this.loadData();
    } catch (error) {
      showError(`Failed to update user: ${error.message}`);
    }
  }

  async loadData() {
    try {
      const [users, teams] = await Promise.all([
        get('/api/admin/users'),
        get('/api/admin/teams')
      ]);

      this.users = users;
      this.teams = teams;

      this.renderUsers();
      this.renderTeams();
      this.populateSelects();
    } catch (error) {
      console.error('Failed to load management data:', error);
      showError(`Failed to load data: ${error.message}`);
    }
  }

  renderUsers() {
    const list = q('#u_list');
    if (!list) return;

    list.innerHTML = '';
    this.users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `
        <div class="user-row-info">
          <span class="user-row-name">${escapeHtml(u.name)}</span>
          ${u.email ? `<span class="user-row-email">${escapeHtml(u.email)}</span>` : ''}
          ${u.is_admin ? '<span class="user-row-admin">Admin</span>' : ''}
        </div>
        <div class="user-row-actions">
          <button data-act="edit" data-id="${u.id}" class="secondary">Edit</button>
          <button data-act="reset" data-id="${u.id}" class="secondary">Reset PW</button>
          <button data-act="del" data-id="${u.id}" class="secondary">Delete</button>
        </div>
      `;
      list.appendChild(row);
    });
  }

  renderTeams() {
    // Teams are rendered via selects, not a table
  }

  populateSelects() {
    // Team select
    const teamSelect = q('#t_select');
    if (teamSelect) {
      teamSelect.innerHTML = '';
      this.teams.forEach(t => {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        teamSelect.appendChild(o);
      });

      // Load first team's members if available
      if (this.teams.length > 0) {
        this.loadTeamMembers(this.teams[0].id);
      }
    }

    // User select
    const userSelect = q('#t_user_select');
    if (userSelect) {
      userSelect.innerHTML = '';
      this.users.forEach(u => {
        const o = document.createElement('option');
        o.value = u.id;
        o.textContent = u.email ? `${u.name} (${u.email})` : u.name;
        userSelect.appendChild(o);
      });
    }
  }

  showPasswordReveal(label, password) {
    const reveal = q('#u_password_reveal');
    const labelEl = q('#u_password_label');
    const displayEl = q('#u_password_display');
    if (!reveal || !labelEl || !displayEl) return;
    labelEl.textContent = label;
    displayEl.textContent = password;
    reveal.classList.remove('hidden');
  }

  copyPassword() {
    const displayEl = q('#u_password_display');
    if (!displayEl || !displayEl.textContent) return;
    navigator.clipboard.writeText(displayEl.textContent).then(() => {
      showSuccess('Password copied to clipboard');
    }).catch(() => {
      showError('Could not copy to clipboard');
    });
  }

  async createUser() {
    try {
      const username = q('#u_name')?.value.trim();
      const email = q('#u_email')?.value.trim();

      if (!username) {
        showError('Username is required');
        return;
      }

      const result = await post('/api/admin/users', { username, email: email || undefined });
      showSuccess('User created successfully');
      if (result?.password) {
        this.showPasswordReveal('Send this password to the user through a secure channel (it will not be shown again):', result.password);
      }

      // Reload data
      await this.loadData();

      // Clear form
      if (q('#u_name')) q('#u_name').value = '';
      if (q('#u_email')) q('#u_email').value = '';
    } catch (error) {
      showError(`Failed to create user: ${error.message}`);
    }
  }

  async createTeam() {
    try {
      const name = q('#t_name')?.value.trim();

      if (!name) {
        showError('Team name is required');
        return;
      }

      await post('/api/admin/teams', { name });
      showSuccess('Team created successfully');
      
      // Reload data
      await this.loadData();
      
      // Clear form
      if (q('#t_name')) q('#t_name').value = '';
    } catch (error) {
      showError(`Failed to create team: ${error.message}`);
    }
  }

  async addTeamMember() {
    try {
      const teamId = q('#t_select')?.value;
      const userId = q('#t_user_select')?.value;

      if (!teamId || !userId) {
        showError('Please select both team and user');
        return;
      }

      await post(`/api/admin/teams/${teamId}/members`, { userId });
      showSuccess('Team member added successfully');
      
      // Reload team members
      await this.loadTeamMembers(teamId);
    } catch (error) {
      showError(`Failed to add team member: ${error.message}`);
    }
  }

  async loadTeamMembers(teamId) {
    try {
      const members = await get(`/api/admin/teams/${teamId}/members`);
      const list = q('#t_list');

      if (!list) return;

      list.innerHTML = '';

      if (members.length === 0) {
        list.innerHTML = '<div class="member-row" style="justify-content: center; color: var(--muted);">No members in this team</div>';
        return;
      }

      members.forEach(m => {
        const row = document.createElement('div');
        row.className = 'member-row';
        row.innerHTML = `
          <div class="member-row-info">
            <span class="member-row-name">${escapeHtml(m.name || '—')}</span>
            <span class="member-row-email">${escapeHtml(m.email)}</span>
          </div>
          <div class="member-row-actions">
            <button data-act="kick" data-uid="${m.id}" class="secondary">Remove</button>
          </div>
        `;
        list.appendChild(row);
      });
    } catch (error) {
      console.error('Failed to load team members:', error);
      showError(`Failed to load team members: ${error.message}`);
    }
  }

  async resetUserPassword(userId) {
    if (!confirm('Reset password for this user? A new password will be shown so you can send it to them.')) return;

    try {
      const result = await post(`/api/admin/users/${userId}/reset-password`);
      showSuccess('Password reset. Copy the new password and send it to the user.');
      if (result?.password) {
        this.showPasswordReveal('New password (send to user through a secure channel):', result.password);
      }
    } catch (error) {
      showError(`Failed to reset password: ${error.message}`);
    }
  }

  async deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
      await del(`/api/admin/users/${userId}`);
      showSuccess('User deleted successfully');
      await this.loadData();
    } catch (error) {
      showError(`Failed to delete user: ${error.message}`);
    }
  }

  async removeTeamMember(userId) {
    const teamId = q('#t_select')?.value;
    if (!teamId) return;

    if (!confirm('Remove this member from the team?')) return;
    
    try {
      await del(`/api/admin/teams/${teamId}/members/${userId}`);
      showSuccess('Team member removed');
      await this.loadTeamMembers(teamId);
    } catch (error) {
      showError(`Failed to remove team member: ${error.message}`);
    }
  }
}

export const managementPage = new ManagementPage();
