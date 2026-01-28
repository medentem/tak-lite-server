/**
 * Command Palette Component
 * Provides quick actions and search via ⌘K
 */

import { q } from '../utils/dom.js';

export class CommandPalette {
  constructor(options = {}) {
    this.palette = q('#command-palette');
    this.input = q('#command-palette-input');
    this.results = q('#command-palette-results');
    this.toggleBtn = q('#command-palette-toggle');
    this.selectedIndex = 0;
    this.commands = [];
    this.filteredCommands = [];
    
    this.options = {
      onCommandSelect: null,
      ...options
    };
    
    this.init();
  }

  init() {
    if (!this.palette || !this.input) return;
    
    // Setup toggle button
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => this.toggle());
    }
    
    // Keyboard shortcut (⌘K or Ctrl+K)
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.toggle();
      }
      
      // Handle escape to close
      if (e.key === 'Escape' && !this.palette.classList.contains('hidden')) {
        this.hide();
      }
    });
    
    // Input handler
    this.input.addEventListener('input', (e) => {
      this.filter(e.target.value);
    });
    
    // Keyboard navigation
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.selectNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.selectPrevious();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.executeSelected();
      }
    });
    
    // Initialize commands
    this.registerDefaultCommands();
  }

  registerDefaultCommands() {
    this.commands = [
      {
        id: 'create-poi',
        title: 'Create Point of Interest',
        description: 'Add a new POI annotation',
        icon: '🎯',
        shortcut: 'P',
        action: () => {
          // Trigger POI creation
          console.log('Create POI');
        }
      },
      {
        id: 'create-area',
        title: 'Create Area',
        description: 'Draw an area annotation',
        icon: '📐',
        shortcut: 'A',
        action: () => {
          console.log('Create Area');
        }
      },
      {
        id: 'create-line',
        title: 'Create Route',
        description: 'Draw a line/route annotation',
        icon: '➖',
        shortcut: 'L',
        action: () => {
          console.log('Create Line');
        }
      },
      {
        id: 'view-threats',
        title: 'View All Threats',
        description: 'Open threats page',
        icon: '⚠️',
        shortcut: 'T',
        action: () => {
          document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'threats' } }));
          this.hide();
        }
      },
      {
        id: 'view-messages',
        title: 'View All Messages',
        description: 'Open messages page',
        icon: '💬',
        shortcut: 'M',
        action: () => {
          document.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'messages' } }));
          this.hide();
        }
      },
      {
        id: 'center-map',
        title: 'Center Map',
        description: 'Reset map view to center',
        icon: '⌂',
        shortcut: 'C',
        action: () => {
          const centerBtn = q('#map_center');
          if (centerBtn) centerBtn.click();
          this.hide();
        }
      },
      {
        id: 'refresh-data',
        title: 'Refresh Data',
        description: 'Reload map data',
        icon: '↻',
        shortcut: 'R',
        action: () => {
          const refreshBtn = q('#map_refresh');
          if (refreshBtn) refreshBtn.click();
          this.hide();
        }
      }
    ];
    
    this.filteredCommands = [...this.commands];
    this.render();
  }

  registerCommand(command) {
    this.commands.push(command);
    this.filter(this.input?.value || '');
  }

  filter(query) {
    const lowerQuery = query.toLowerCase();
    this.filteredCommands = this.commands.filter(cmd => 
      cmd.title.toLowerCase().includes(lowerQuery) ||
      cmd.description.toLowerCase().includes(lowerQuery) ||
      cmd.id.toLowerCase().includes(lowerQuery)
    );
    this.selectedIndex = 0;
    this.render();
  }

  render() {
    if (!this.results) return;
    
    if (this.filteredCommands.length === 0) {
      this.results.innerHTML = '<div class="command-palette-item"><div class="command-palette-item-content"><div class="command-palette-item-title">No commands found</div></div></div>';
      return;
    }
    
    this.results.innerHTML = this.filteredCommands.map((cmd, index) => `
      <div class="command-palette-item ${index === this.selectedIndex ? 'selected' : ''}" data-index="${index}">
        <div class="command-palette-item-icon">${cmd.icon || '⚡'}</div>
        <div class="command-palette-item-content">
          <div class="command-palette-item-title">${cmd.title}</div>
          <div class="command-palette-item-description">${cmd.description || ''}</div>
        </div>
        ${cmd.shortcut ? `<div class="command-palette-item-shortcut">${cmd.shortcut}</div>` : ''}
      </div>
    `).join('');
    
    // Add click handlers
    this.results.querySelectorAll('.command-palette-item').forEach((item, index) => {
      item.addEventListener('click', () => {
        this.selectedIndex = index;
        this.executeSelected();
      });
    });
  }

  selectNext() {
    if (this.selectedIndex < this.filteredCommands.length - 1) {
      this.selectedIndex++;
    } else {
      this.selectedIndex = 0;
    }
    this.render();
  }

  selectPrevious() {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    } else {
      this.selectedIndex = this.filteredCommands.length - 1;
    }
    this.render();
  }

  executeSelected() {
    const command = this.filteredCommands[this.selectedIndex];
    if (command && command.action) {
      command.action();
      if (this.options.onCommandSelect) {
        this.options.onCommandSelect(command);
      }
    }
  }

  toggle() {
    if (this.palette.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  show() {
    if (this.palette) {
      this.palette.classList.remove('hidden');
      if (this.input) {
        this.input.focus();
        this.input.select();
      }
      this.filter('');
    }
  }

  hide() {
    if (this.palette) {
      this.palette.classList.add('hidden');
      if (this.input) {
        this.input.value = '';
      }
      this.selectedIndex = 0;
    }
  }
}
