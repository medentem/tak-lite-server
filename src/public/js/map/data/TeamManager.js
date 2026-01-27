/**
 * Team Manager
 * Manages team data and selection
 */

import { logger } from '../../utils/logger.js';
import { get } from '../../utils/api.js';
import { q } from '../../utils/dom.js';
import { API_ENDPOINTS } from '../../config/mapConfig.js';

export class TeamManager {
  /**
   * Create a team manager
   * @param {EventBus} eventBus - Event bus instance
   */
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.teams = [];
  }

  /**
   * Load teams from API
   * @returns {Promise<Array>} Array of teams
   */
  async loadTeams() {
    try {
      this.teams = await get(API_ENDPOINTS.teams);
      this.populateTeamSelect();
      this.eventBus.emit('teams:loaded', this.teams);
      logger.info(`Loaded ${this.teams.length} teams`);
      return this.teams;
    } catch (error) {
      logger.error('Failed to load teams:', error);
      this.teams = [];
      return [];
    }
  }

  /**
   * Populate team select dropdown
   */
  populateTeamSelect() {
    const select = q('#map_team_select');
    if (!select) {
      logger.warn('Team select element not found');
      return;
    }
    
    // Clear existing options except "All Teams"
    select.innerHTML = '<option value="">All Teams</option>';
    
    this.teams.forEach(team => {
      const option = document.createElement('option');
      option.value = team.id;
      option.textContent = team.name;
      select.appendChild(option);
    });
    
    logger.debug(`Populated team select with ${this.teams.length} teams`);
  }

  /**
   * Get teams array
   * @returns {Array} Teams array
   */
  getTeams() {
    return this.teams;
  }

  /**
   * Set teams array
   * @param {Array} teams - Teams array
   */
  setTeams(teams) {
    this.teams = teams;
    this.populateTeamSelect();
  }

  /**
   * Find team by ID
   * @param {string} teamId - Team ID
   * @returns {Object|undefined} Team or undefined
   */
  findTeam(teamId) {
    return this.teams.find(team => team.id === teamId);
  }

  /**
   * Get team name by ID
   * @param {string} teamId - Team ID
   * @returns {string} Team name or 'Unknown Team'
   */
  getTeamName(teamId) {
    const team = this.findTeam(teamId);
    return team ? team.name : 'Unknown Team';
  }
}
