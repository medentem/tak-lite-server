/**
 * Management page module (Users & Teams)
 */

import { q, showMessage, showError, showSuccess } from '../utils/dom.js';
import { get, post, del } from '../utils/api.js';

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

      if (action === 'reset') {
        this.resetUserPassword(id);
      } else if (action === 'del') {
        this.deleteUser(id);
      } else if (action === 'kick') {
        this.removeTeamMember(id);
      }
    });
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
    const tbody = q('#u_table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    this.users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.email}</td>
        <td>${u.name || ''}</td>
        <td>${u.is_admin ? 'Yes' : 'No'}</td>
        <td><div class="row" style="flex-wrap:nowrap;gap:8px;">
          <button data-act="reset" data-id="${u.id}" class="secondary">Reset PW</button>
          <button data-act="del" data-id="${u.id}" class="secondary">Delete</button>
        </div></td>
      `;
      tbody.appendChild(tr);
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
        o.textContent = `${u.name || ''} <${u.email}>`;
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
      const email = q('#u_email')?.value.trim();
      const name = q('#u_name')?.value.trim();

      if (!email) {
        showError('Email is required');
        return;
      }

      const result = await post('/api/admin/users', { email, name });
      showSuccess('User created successfully');
      if (result?.password) {
        this.showPasswordReveal('Send this password to the user through a secure channel (it will not be shown again):', result.password);
      }

      // Reload data
      await this.loadData();

      // Clear form
      if (q('#u_email')) q('#u_email').value = '';
      if (q('#u_name')) q('#u_name').value = '';
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
      const tbody = q('#t_table tbody');
      
      if (!tbody) return;

      tbody.innerHTML = '';

      if (members.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--muted);">No members in this team</td></tr>';
        return;
      }

      members.forEach(m => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${m.name || ''}</td>
          <td>${m.email}</td>
          <td>
            <button data-act="kick" data-uid="${m.id}" class="secondary">Remove</button>
          </td>
        `;
        tbody.appendChild(tr);
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
