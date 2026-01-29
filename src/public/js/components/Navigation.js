/**
 * Navigation component
 */

import { q } from '../utils/dom.js';

export class Navigation {
  constructor() {
    this.currentPage = 'dashboard';
    this.pages = ['dashboard', 'settings', 'management', 'threats', 'messages'];
    this.init();
  }

  init() {
    this.setupNavigationLinks();
    this.setupBrowserHistory();
    this.checkInitialPage();
  }

  setupNavigationLinks() {
    this.pages.forEach(page => {
      const link = q(`#nav-${page}`);
      if (link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.navigate(page);
        });
      }
    });
  }

  setupBrowserHistory() {
    window.addEventListener('popstate', (e) => {
      const page = e.state?.page || 'dashboard';
      this.showPage(page, false);
    });
  }

  checkInitialPage() {
    const hash = window.location.hash.substring(1);
    if (hash && this.pages.includes(hash)) {
      this.navigate(hash, false);
    } else {
      this.navigate('dashboard', false);
    }
  }

  navigate(page, pushState = true) {
    if (!this.pages.includes(page)) {
      console.warn(`Invalid page: ${page}`);
      return;
    }

    this.showPage(page, pushState);
  }

  showPage(page, pushState = true) {
    // Hide all pages
    this.pages.forEach(p => {
      const pageEl = q(`#${p === 'dashboard' ? 'dash' : p + 'Page'}`);
      if (pageEl) {
        pageEl.classList.add('hidden');
      }
    });

    // Show selected page
    const pageId = page === 'dashboard' ? 'dash' : page + 'Page';
    const pageEl = q(`#${pageId}`);
    if (pageEl) {
      pageEl.classList.remove('hidden');
    }

    // All admin pages use full-width container
    document.body.classList.add('admin-page-visible');
    // Dashboard also needs flex layout so map fills below nav
    if (page === 'dashboard') {
      document.body.classList.add('dashboard-visible');
    } else {
      document.body.classList.remove('dashboard-visible');
    }

    // Update navigation links
    this.pages.forEach(p => {
      const link = q(`#nav-${p}`);
      if (link) {
        if (p === page) {
          link.style.color = 'var(--text)';
          link.style.background = 'var(--accent)';
          link.style.fontWeight = '500';
        } else {
          link.style.color = 'var(--muted)';
          link.style.background = 'transparent';
          link.style.fontWeight = 'normal';
        }
      }
    });

    this.currentPage = page;

    // Update browser history
    if (pushState) {
      window.history.pushState({ page }, '', `#${page}`);
    }

    // Dispatch custom event
    document.dispatchEvent(new CustomEvent('pageChanged', { detail: { page } }));
  }

  getCurrentPage() {
    return this.currentPage;
  }
}
