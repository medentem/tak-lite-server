/**
 * Threat Manager
 * Manages threat visualization on the map
 */

import { logger } from '../../utils/logger.js';
import { get } from '../../utils/api.js';
import { LAYER_CONFIG } from '../../config/mapConfig.js';

export class ThreatManager {
  constructor(map, eventBus) {
    this.map = map;
    this.eventBus = eventBus;
    this.threats = [];
    this.threatSource = null;
    this.threatLayer = 'threats-layer';
    this.pulsingMarkers = new Map(); // Track pulsing animations
  }

  /**
   * Initialize threat visualization
   */
  async init() {
    if (!this.map.isStyleLoaded()) {
      this.map.once('styledata', () => this.init());
      return;
    }

    this.setupSource();
    this.setupLayer();
    await this.loadThreats();
  }

  /**
   * Setup threat source
   */
  setupSource() {
    const sourceId = 'threats-source';
    
    if (!this.map.getSource(sourceId)) {
      this.map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      this.threatSource = sourceId;
      logger.debug('Added threat source');
    } else {
      this.threatSource = sourceId;
    }
  }

  /**
   * Setup threat layer with pulsing animation
   */
  setupLayer() {
    if (this.map.getLayer(this.threatLayer)) {
      logger.debug('Threat layer already exists');
      return;
    }

    // Add circle layer for pulsing effect
    this.map.addLayer({
      id: this.threatLayer,
      type: 'circle',
      source: this.threatSource,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, 8,
          12, 12,
          16, 16
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'threat_level'], 'CRITICAL'], '#dc2626',
          ['==', ['get', 'threat_level'], 'HIGH'], '#ef4444',
          ['==', ['get', 'threat_level'], 'MEDIUM'], '#f59e0b',
          '#22c55e' // LOW
        ],
        'circle-opacity': [
          'case',
          ['==', ['get', 'threat_level'], 'CRITICAL'], 0.8,
          ['==', ['get', 'threat_level'], 'HIGH'], 0.7,
          ['==', ['get', 'threat_level'], 'MEDIUM'], 0.6,
          0.5 // LOW
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.8
      }
    });

    // Add pulsing animation layer (outer ring)
    this.map.addLayer({
      id: `${this.threatLayer}-pulse`,
      type: 'circle',
      source: this.threatSource,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8, 12,
          12, 18,
          16, 24
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'threat_level'], 'CRITICAL'], '#dc2626',
          ['==', ['get', 'threat_level'], 'HIGH'], '#ef4444',
          ['==', ['get', 'threat_level'], 'MEDIUM'], '#f59e0b',
          '#22c55e'
        ],
        'circle-opacity': [
          'interpolate',
          ['linear'],
          ['get', 'pulsePhase'],
          0, 0.6,
          0.5, 0.3,
          1, 0
        ],
        'circle-stroke-width': 0
      }
    });

    // Setup click handler
    this.map.on('click', this.threatLayer, (e) => {
      const feature = e.features[0];
      if (feature) {
        this.handleThreatClick(feature, e.lngLat);
      }
    });

    // Setup hover cursor
    this.map.on('mouseenter', this.threatLayer, () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', this.threatLayer, () => {
      this.map.getCanvas().style.cursor = '';
    });

    // Start pulsing animation
    this.startPulsingAnimation();
  }

  /**
   * Start pulsing animation for threats
   */
  startPulsingAnimation() {
    const animate = () => {
      if (!this.map.getSource(this.threatSource)) return;
      
      const source = this.map.getSource(this.threatSource);
      if (source && source._data) {
        const features = source._data.features || [];
        const now = Date.now();
        
        features.forEach(feature => {
          const threatLevel = feature.properties.threat_level;
          if (threatLevel === 'CRITICAL' || threatLevel === 'HIGH') {
            // Calculate pulse phase (0 to 1)
            const pulseSpeed = threatLevel === 'CRITICAL' ? 1000 : 1500; // Faster for critical
            const pulsePhase = ((now % pulseSpeed) / pulseSpeed);
            feature.properties.pulsePhase = pulsePhase;
          } else {
            feature.properties.pulsePhase = 0;
          }
        });
        
        // Update source to trigger repaint
        source.setData(source._data);
      }
      
      requestAnimationFrame(animate);
    };
    
    animate();
  }

  /**
   * Load threats from API
   */
  async loadThreats() {
    try {
      const threats = await get('/api/admin/threats?status=pending&limit=100');
      this.threats = threats;
      this.updateMap();
      logger.debug(`Loaded ${threats.length} threats`);
    } catch (error) {
      logger.error('Failed to load threats:', error);
    }
  }

  /**
   * Update map with current threats
   */
  updateMap() {
    if (!this.threatSource) return;

    const features = this.threats
      .filter(threat => {
        // Only show pending or reviewed threats
        const status = threat.admin_status || 'pending';
        return status === 'pending' || status === 'reviewed';
      })
      .filter(threat => {
        // Only show threats with valid locations
        const locations = threat.extracted_locations || [];
        return locations.length > 0 && locations[0].lat && locations[0].lng;
      })
      .map(threat => {
        const location = threat.extracted_locations[0];
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [location.lng, location.lat]
          },
          properties: {
            threat_id: threat.id,
            threat_level: threat.threat_level,
            threat_type: threat.threat_type,
            confidence_score: threat.confidence_score,
            ai_summary: threat.ai_summary,
            admin_status: threat.admin_status || 'pending',
            pulsePhase: 0
          }
        };
      });

    const source = this.map.getSource(this.threatSource);
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features
      });
    }
  }

  /**
   * Handle threat click
   */
  handleThreatClick(feature, lngLat) {
    const threatId = feature.properties.threat_id;
    const threat = this.threats.find(t => t.id === threatId);
    
    if (threat) {
      // Emit event for threat selection
      this.eventBus.emit('threat:selected', { threat, lngLat });
      
      // Pan/zoom to threat location
      this.map.flyTo({
        center: [lngLat.lng, lngLat.lat],
        zoom: Math.max(this.map.getZoom(), 14),
        duration: 1000
      });
    }
  }

  /**
   * Pan to threat location
   */
  panToThreat(threatId) {
    const threat = this.threats.find(t => t.id === threatId);
    if (!threat) return;

    const locations = threat.extracted_locations || [];
    if (locations.length === 0) return;

    const location = locations[0];
    this.map.flyTo({
      center: [location.lng, location.lat],
      zoom: Math.max(this.map.getZoom(), 14),
      duration: 1000
    });

    // Pulse the marker 3 times
    this.pulseThreatMarker(threatId, 3);
  }

  /**
   * Pulse threat marker
   */
  pulseThreatMarker(threatId, times = 3) {
    const source = this.map.getSource(this.threatSource);
    if (!source || !source._data) return;

    let pulseCount = 0;
    const pulseInterval = setInterval(() => {
      const features = source._data.features || [];
      const feature = features.find(f => f.properties.threat_id === threatId);
      
      if (feature) {
        // Temporarily increase opacity for pulse
        feature.properties.pulsePhase = 1;
        source.setData(source._data);
        
        setTimeout(() => {
          feature.properties.pulsePhase = 0;
          source.setData(source._data);
          pulseCount++;
          
          if (pulseCount >= times) {
            clearInterval(pulseInterval);
          }
        }, 200);
      } else {
        clearInterval(pulseInterval);
      }
    }, 400);
  }

  /**
   * Refresh threats
   */
  async refresh() {
    await this.loadThreats();
  }

  /**
   * Get threats
   */
  getThreats() {
    return this.threats;
  }
}
