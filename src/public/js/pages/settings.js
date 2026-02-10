/**
 * Settings page module
 */

import { q, showMessage, showError, showSuccess, setLoading } from '../utils/dom.js';
import { get, put } from '../utils/api.js';

export class SettingsPage {
  constructor() {
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    
    this.setupControls();
    this.loadSettings();
    this.initialized = true;
  }

  setupControls() {
    const saveBtn = q('#save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveSettings());
    }
  }

  async loadSettings() {
    try {
      const config = await get('/api/admin/config');
      
      const orgEl = q('#org');
      const corsEl = q('#cors');
      const retentionEl = q('#retention');
      
      if (orgEl) orgEl.value = config.orgName || '';
      if (corsEl) corsEl.value = config.corsOrigin || '';
      if (retentionEl) retentionEl.value = config.retentionDays || 0;
    } catch (error) {
      console.error('Failed to load settings:', error);
      showError(`Failed to load settings: ${error.message}`);
    }
  }

  async saveSettings() {
    const saveBtn = q('#save');
    try {
      setLoading(saveBtn, true);

      const orgName = q('#org')?.value.trim() || '';
      const corsOrigin = q('#cors')?.value.trim() || '';
      const retentionDays = parseInt(q('#retention')?.value || '0', 10);

      if (!orgName) {
        showError('Organization name is required');
        return;
      }

      await put('/api/admin/config', {
        orgName,
        corsOrigin,
        retentionDays
      });

      showSuccess('Settings saved successfully');
    } catch (error) {
      console.error('Failed to save settings:', error);
      showError(`Failed to save settings: ${error.message}`);
    } finally {
      setLoading(saveBtn, false);
    }
  }
}

export const settingsPage = new SettingsPage();
