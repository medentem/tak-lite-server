/**
 * Navigation component
 */

import { q } from '../utils/dom.js';

export class Navigation {
  constructor(isAdmin = true) {
    this.currentPage = 'dashboard';
    this.isAdmin = isAdmin;
    this.pages = isAdmin ? ['dashboard', 'settings', 'management', 'threats', 'messages'] : ['dashboard'];
    this.init();
  }

  init() {
    this.setupNavigationLinks();
    if (!this.isAdmin) {
      ['threats', 'messages', 'settings', 'management'].forEach((page) => {
        const link = q(`#nav-${page}`);
        if (link) link.style.display = 'none';
        document.querySelectorAll(`[data-nav-page="${page}"]`).forEach((el) => {
          el.style.display = 'none';
        });
      });
      const socialLink = q('#nav-social');
      if (socialLink) socialLink.style.display = 'none';
    }
    this.setupBrowserHistory();
    this.checkInitialPage();
  }

  setupNavigationLinks() {
    this.pages.forEach(page => {
      const links = document.querySelectorAll(`[data-nav-page="${page}"]`);
      links.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.navigate(page);
          document.dispatchEvent(new CustomEvent('navDrawerClose'));
        });
      });
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
    if (!this.isAdmin) {
      document.body.classList.add('dashboard-visible');
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

    // Update navigation links (desktop nav + mobile drawer)
    document.querySelectorAll('[data-nav-page]').forEach((link) => {
      const linkPage = link.getAttribute('data-nav-page');
      if (linkPage === page) {
        link.classList.add('nav-active');
      } else {
        link.classList.remove('nav-active');
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
