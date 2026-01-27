/**
 * Modal component
 */

import { q } from '../utils/dom.js';

export class Modal {
  constructor(id) {
    this.id = id;
    this.element = q(`#${id}`);
    this.overlay = q('#modal_overlay') || this.createOverlay();
    this.init();
  }

  createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'modal_overlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
    return overlay;
  }

  init() {
    if (!this.element) {
      console.warn(`Modal element #${this.id} not found`);
      return;
    }

    // Close on overlay click
    this.overlay.addEventListener('click', () => {
      this.hide();
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isVisible()) {
        this.hide();
      }
    });

    // Find close buttons
    const closeButtons = this.element.querySelectorAll('.close, [data-close]');
    closeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.hide();
      });
    });
  }

  show() {
    if (!this.element) return;

    this.element.style.display = 'block';
    this.overlay.classList.add('visible');
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Dispatch event
    document.dispatchEvent(new CustomEvent('modalShown', { detail: { id: this.id } }));
  }

  hide() {
    if (!this.element) return;

    this.element.style.display = 'none';
    this.overlay.classList.remove('visible');
    
    // Restore body scroll
    document.body.style.overflow = '';

    // Dispatch event
    document.dispatchEvent(new CustomEvent('modalHidden', { detail: { id: this.id } }));
  }

  toggle() {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible() {
    return this.element && this.element.style.display !== 'none';
  }

  setContent(html) {
    if (this.element) {
      const content = this.element.querySelector('.modal-content') || this.element;
      content.innerHTML = html;
    }
  }
}

/**
 * Static helper to show/hide modals
 */
export function showModal(id) {
  const modal = new Modal(id);
  modal.show();
  return modal;
}

export function hideModal(id) {
  const modal = new Modal(id);
  modal.hide();
}
