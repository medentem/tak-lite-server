/**
 * Floating HUD Panel Component
 * Manages the semi-transparent floating panels for threats and messages
 */

import { q } from '../utils/dom.js';

export class HUDPanel {
  constructor(panelId, options = {}) {
    this.panelId = panelId;
    this.panel = q(`#${panelId}`);
    this.pinned = false;
    this.options = {
      onPin: null,
      onUnpin: null,
      ...options
    };
    
    this.init();
  }

  init() {
    if (!this.panel) return;
    
    // Setup pin button
    const pinBtn = this.panel.querySelector('.hud-panel-pin');
    if (pinBtn) {
      pinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePin();
      });
    }
    
    // Prevent panel from closing when clicking inside
    this.panel.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  togglePin() {
    this.pinned = !this.pinned;
    const pinBtn = this.panel.querySelector('.hud-panel-pin');
    
    if (this.pinned) {
      this.panel.classList.add('pinned');
      if (pinBtn) pinBtn.classList.add('pinned');
      if (this.options.onPin) this.options.onPin();
    } else {
      this.panel.classList.remove('pinned');
      if (pinBtn) pinBtn.classList.remove('pinned');
      if (this.options.onUnpin) this.options.onUnpin();
    }
  }

  setContent(html) {
    const content = this.panel.querySelector('.hud-panel-content');
    if (content) {
      content.innerHTML = html;
    }
  }

  updateBadge(count) {
    const badge = this.panel.querySelector('.hud-panel-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  }

  show() {
    if (this.panel) {
      this.panel.style.display = 'flex';
    }
  }

  hide() {
    if (this.panel && !this.pinned) {
      // Only hide if not pinned
      this.panel.style.opacity = '0.2';
    }
  }
}
