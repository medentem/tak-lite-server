/**
 * User Location Manager
 * Watches browser GPS, draws a self blue-dot, and optionally shares
 * position with the team via socket (with REST fallback).
 */

import { logger } from '../../utils/logger.js';
import { post } from '../../utils/api.js';
import { getItem, setItem } from '../../utils/storage.js';
import { haversineDistance, generateCirclePolygon } from '../../utils/geography.js';
import { LAYER_CONFIG, DISPLAY_CONFIG, TIMING, API_ENDPOINTS } from '../../config/mapConfig.js';
import { websocketService } from '../../services/websocket.js';
import { MAP_EVENTS } from '../events/EventBus.js';
import { q } from '../../utils/dom.js';

const SHARE_PREF_KEY = 'taklite:shareLocation';
const EMPTY_FC = { type: 'FeatureCollection', features: [] };

export class UserLocationManager {
  /**
   * @param {maplibregl.Map} map
   * @param {EventBus} eventBus
   * @param {Object} deps
   * @param {() => string|null} deps.getCurrentTeamId
   * @param {() => Array} deps.getTeams
   * @param {() => string|null} deps.getUserId
   * @param {(msg: string, duration?: number) => void} [deps.showFeedback]
   */
  constructor(map, eventBus, deps = {}) {
    this.map = map;
    this.eventBus = eventBus;
    this.getCurrentTeamId = deps.getCurrentTeamId || (() => null);
    this.getTeams = deps.getTeams || (() => []);
    this.getUserId = deps.getUserId || (() => null);
    this.getIsAdmin = deps.getIsAdmin || (() => false);
    this.showFeedback = deps.showFeedback || (() => {});

    this.lngLat = null;
    this.accuracy = null;
    this.watchId = null;
    this.sharingEnabled = getItem(SHARE_PREF_KEY, true) !== false;
    this.canShare = true;
    this.lastShareAt = 0;
    this.lastSharedLngLat = null;
    this.joinedTeamIds = new Set();
    this._pageHandler = null;
    this._socketHandler = null;
  }

  /**
   * Current user position as { lng, lat } or null
   */
  getLngLat() {
    return this.lngLat;
  }

  isSharingEnabled() {
    return this.sharingEnabled;
  }

  /**
   * Start GPS watch and bind UI. Safe to call more than once.
   */
  start() {
    this.ensureLayers();
    this.updateShareButton();
    this.startWatching();
    this.syncTeamRooms();

    if (!this._pageHandler) {
      this._pageHandler = (e) => {
        if (e.detail?.page === 'dashboard') {
          this.startWatching();
        } else {
          this.stopWatching();
        }
      };
      document.addEventListener('pageChanged', this._pageHandler);
    }

    if (!this._socketHandler) {
      this._socketHandler = () => this.syncTeamRooms();
      document.addEventListener('socketConnected', this._socketHandler);
    }
  }

  stop() {
    this.stopWatching();
    if (this._pageHandler) {
      document.removeEventListener('pageChanged', this._pageHandler);
      this._pageHandler = null;
    }
    if (this._socketHandler) {
      document.removeEventListener('socketConnected', this._socketHandler);
      this._socketHandler = null;
    }
    this.leaveJoinedTeams();
  }

  startWatching() {
    if (this.watchId != null) return;
    if (!navigator.geolocation) {
      logger.debug('Geolocation not available');
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handlePosition(position),
      (error) => {
        if (error.code !== error.PERMISSION_DENIED) {
          logger.debug('Geolocation watch error:', error.message);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: TIMING.geolocationWatchTimeout ?? 10000,
        maximumAge: 5000
      }
    );
  }

  stopWatching() {
    if (this.watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  handlePosition(position) {
    const { latitude, longitude, altitude, accuracy } = position.coords;
    this.lngLat = { lng: longitude, lat: latitude };
    this.accuracy = typeof accuracy === 'number' ? accuracy : null;
    this.altitude = typeof altitude === 'number' ? altitude : null;

    this.updateMap();
    this.eventBus.emit(MAP_EVENTS.USER_LOCATION_UPDATED, {
      lngLat: this.lngLat,
      accuracy: this.accuracy
    });

    if (this.sharingEnabled) {
      this.maybeShare(position);
    }
  }

  ensureLayers() {
    if (!this.map || !this.map.isStyleLoaded()) return;

    const sources = LAYER_CONFIG.sources;
    if (!this.map.getSource(sources.userLocationAccuracy)) {
      this.map.addSource(sources.userLocationAccuracy, {
        type: 'geojson',
        data: EMPTY_FC
      });
    }
    if (!this.map.getSource(sources.userLocation)) {
      this.map.addSource(sources.userLocation, {
        type: 'geojson',
        data: EMPTY_FC
      });
    }

    if (!this.map.getLayer(LAYER_CONFIG.userLocationAccuracyLayer)) {
      this.map.addLayer({
        id: LAYER_CONFIG.userLocationAccuracyLayer,
        type: 'fill',
        source: sources.userLocationAccuracy,
        paint: {
          'fill-color': '#2196F3',
          'fill-opacity': 0.15
        }
      });
    }

    if (!this.map.getLayer(LAYER_CONFIG.userLocationLayer)) {
      this.map.addLayer({
        id: LAYER_CONFIG.userLocationLayer,
        type: 'circle',
        source: sources.userLocation,
        paint: {
          'circle-radius': 7,
          'circle-color': '#2196F3',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#FFFFFF'
        }
      });
    }

    this.updateMap();
  }

  updateMap() {
    if (!this.map || !this.lngLat) return;
    const puckSource = this.map.getSource(LAYER_CONFIG.sources.userLocation);
    const accSource = this.map.getSource(LAYER_CONFIG.sources.userLocationAccuracy);
    if (!puckSource) return;

    puckSource.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [this.lngLat.lng, this.lngLat.lat]
        },
        properties: {}
      }]
    });

    if (accSource) {
      const radius = this.accuracy && this.accuracy > 0 ? this.accuracy : 0;
      if (radius >= 8) {
        const ring = generateCirclePolygon(this.lngLat.lng, this.lngLat.lat, radius);
        accSource.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ring] },
            properties: {}
          }]
        });
      } else {
        accSource.setData(EMPTY_FC);
      }
    }
  }

  /**
   * @param {boolean} enabled
   * @param {{ persist?: boolean, silent?: boolean }} [opts]
   */
  setSharingEnabled(enabled, opts = {}) {
    const persist = opts.persist !== false;
    this.sharingEnabled = !!enabled;
    if (persist) {
      setItem(SHARE_PREF_KEY, this.sharingEnabled);
    }
    this.updateShareButton();
    if (this.sharingEnabled) {
      this.startWatching();
      this.syncTeamRooms();
      if (this.lngLat) {
        this.lastShareAt = 0;
        this.maybeShare({
          coords: {
            latitude: this.lngLat.lat,
            longitude: this.lngLat.lng,
            altitude: this.altitude,
            accuracy: this.accuracy
          }
        });
      }
    }
  }

  /**
   * Resolve team to share to: selected team, else first membership.
   * @returns {string|null}
   */
  getShareTeamId() {
    const selected = this.getCurrentTeamId();
    if (selected) return selected;
    const teams = this.getTeams() || [];
    return teams[0]?.id || null;
  }

  setCanShare(canShare, hint) {
    this.canShare = canShare;
    this.updateShareButton(hint);
  }

  updateShareAvailability() {
    const teamId = this.getShareTeamId();
    if (!teamId) {
      this.setCanShare(false, 'Join a team to share your location');
    } else {
      this.setCanShare(true);
    }
    this.syncTeamRooms();
  }

  updateShareButton(hint) {
    const btn = q('#map_share_location');
    if (!btn) return;
    const on = this.sharingEnabled && this.canShare;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(!!this.sharingEnabled));
    btn.disabled = !this.canShare;
    btn.title = hint || (this.sharingEnabled ? 'Sharing location (tap to stop)' : 'Share my location');
  }

  maybeShare(position) {
    const teamId = this.getShareTeamId();
    if (!teamId || !this.canShare) return;

    const coords = position.coords;
    const now = Date.now();
    const minInterval = TIMING.shareLocationMinIntervalMs ?? 5000;
    const minDistance = TIMING.shareLocationMinDistanceMeters ?? 10;

    if (this.lastSharedLngLat) {
      const moved = haversineDistance(
        this.lastSharedLngLat.lat,
        this.lastSharedLngLat.lng,
        coords.latitude,
        coords.longitude
      );
      if (now - this.lastShareAt < minInterval && moved < minDistance) {
        return;
      }
    } else if (now - this.lastShareAt < minInterval) {
      return;
    }

    const payload = {
      teamId,
      latitude: coords.latitude,
      longitude: coords.longitude,
      timestamp: now
    };
    if (typeof coords.altitude === 'number' && !Number.isNaN(coords.altitude)) {
      payload.altitude = coords.altitude;
    }
    if (typeof coords.accuracy === 'number' && !Number.isNaN(coords.accuracy)) {
      payload.accuracy = coords.accuracy;
    }

    this.lastShareAt = now;
    this.lastSharedLngLat = { lng: coords.longitude, lat: coords.latitude };
    this.sendLocation(payload);
  }

  sendLocation(payload) {
    if (websocketService.isConnected()) {
      websocketService.emitToServer('location:update', payload);
      return;
    }
    post(API_ENDPOINTS.syncLocation, payload).catch((err) => {
      logger.debug('Location share REST fallback failed:', err?.message);
    });
  }

  syncTeamRooms() {
    const teams = this.getTeams() || [];
    const selected = this.getCurrentTeamId();
    let targetIds;
    if (selected) {
      targetIds = [selected];
    } else if (this.getIsAdmin()) {
      const shareTeam = this.getShareTeamId();
      targetIds = shareTeam ? [shareTeam] : [];
    } else {
      targetIds = teams.map((t) => t.id).filter(Boolean);
    }

    const next = new Set(targetIds);
    for (const id of this.joinedTeamIds) {
      if (!next.has(id)) {
        websocketService.emitToServer('team:leave', id);
        this.joinedTeamIds.delete(id);
      }
    }
    for (const id of next) {
      if (!this.joinedTeamIds.has(id)) {
        websocketService.emitToServer('team:join', id);
        this.joinedTeamIds.add(id);
      }
    }
  }

  leaveJoinedTeams() {
    for (const id of this.joinedTeamIds) {
      websocketService.emitToServer('team:leave', id);
    }
    this.joinedTeamIds.clear();
  }

  bindShareButton() {
    const btn = q('#map_share_location');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      if (!this.canShare) {
        this.showFeedback('Join a team to share your location', 3000);
        return;
      }
      this.setSharingEnabled(!this.sharingEnabled);
      this.showFeedback(
        this.sharingEnabled ? 'Sharing your location with the team' : 'Location sharing off',
        2000
      );
    });
    this.updateShareButton();
  }
}
