# Social Media Threat Detection Feature

This document describes the comprehensive social media threat detection feature implemented for TAK-Lite Server.

## Overview

The Social Media Threat Detection feature enables real-time monitoring of X (Twitter) for potential security threats, AI-powered analysis, and automatic annotation on the TAK-Lite map for field users. This feature transforms TAK-Lite from a location-sharing tool into a powerful situational awareness platform.

## Architecture

### Core Components

1. **SocialMediaMonitoringService** - Manages Twitter API integration and monitoring
2. **ThreatDetectionService** - Handles AI-powered threat analysis using OpenAI
3. **Database Schema** - Stores monitors, posts, analyses, and annotations
4. **Admin API** - RESTful endpoints for configuration and management
5. **Admin UI** - Web interface for setup and monitoring
6. **Real-time Broadcasting** - Socket.IO integration for live threat alerts

### Data Flow

```
Twitter API → SocialMediaMonitoringService → ThreatDetectionService → Threat Annotations → Map Display
     ↓                    ↓                           ↓                      ↓
  Raw Posts          Store Posts              AI Analysis            Real-time Alerts
```

## Database Schema

### New Tables

- **social_media_monitors** - Monitor configurations and settings
- **social_media_posts** - Raw posts from Twitter API
- **threat_analyses** - AI analysis results
- **threat_annotations** - Map annotations for threats
- **ai_configurations** - OpenAI API settings

## Configuration

### Prerequisites

1. **TwitterAPI.io Account** - Get API key from [twitterapi.io](https://twitterapi.io)
2. **OpenAI Account** - Get API key from [OpenAI](https://platform.openai.com)
3. **TAK-Lite Server** - Running instance with admin access

### Setup Steps

1. **Run Database Migrations**
   ```bash
   npm run db:migrate
   ```

2. **Start the Server**
   ```bash
   npm run dev
   ```

3. **Access Admin Interface**
   - Main Admin: http://localhost:3000/admin
   - Social Media: http://localhost:3000/social-media

4. **Configure AI Settings**
   - Navigate to Social Media → AI Configuration
   - Enter OpenAI API key
   - Select model (GPT-4 recommended)
   - Test connection

5. **Create Monitor**
   - Click "Create Monitor"
   - Enter monitor name
   - Configure search query using Twitter's advanced operators
   - Set monitoring interval (60-3600 seconds)
   - Enter TwitterAPI.io API key
   - Test connection

## Search Query Examples

### Emergency Services
```
"emergency" OR "police" OR "fire" OR "ambulance" near:Seattle within:10mi
```

### Natural Disasters
```
"earthquake" OR "flood" OR "fire" OR "storm" near:California within:50mi
```

### Civil Unrest
```
"protest" OR "riot" OR "demonstration" near:Portland within:5mi
```

### Infrastructure Threats
```
"power outage" OR "bridge collapse" OR "gas leak" near:NewYork within:20mi
```

### Advanced Operators
- `"exact phrase"` - Exact phrase matching
- `OR` - Logical OR operator
- `near:location` - Geographic proximity
- `within:distance` - Distance radius
- `from:username` - Posts from specific user
- `since:2024-01-01` - Date filtering
- `lang:en` - Language filtering

## AI Threat Detection

### Threat Levels
- **LOW** - General discussion, no immediate threat
- **MEDIUM** - Potential concern, monitoring recommended
- **HIGH** - Significant threat, immediate attention needed
- **CRITICAL** - Life-threatening situation, emergency response required

### Threat Types
- **VIOLENCE** - Threats of violence, weapons, shootings
- **TERRORISM** - Terrorist threats, bomb threats, extremist activity
- **NATURAL_DISASTER** - Earthquakes, floods, fires, severe weather
- **CIVIL_UNREST** - Protests, riots, civil disturbances
- **INFRASTRUCTURE** - Power outages, transportation issues
- **CYBER** - Cyber attacks, data breaches
- **HEALTH_EMERGENCY** - Disease outbreaks, medical emergencies

### AI Analysis Process
1. **Text Preprocessing** - Clean and normalize post content
2. **Threat Classification** - Determine threat level and type
3. **Location Extraction** - Identify geographic references
4. **Confidence Scoring** - Assess analysis reliability
5. **Summary Generation** - Create human-readable summary

## 🗺️ Map Integration

### Threat Annotations
- **Threat POI** - Single point threats
- **Threat Area** - Geographic areas of concern
- **Threat Line** - Movement patterns
- **Threat Polygon** - Complex threat zones

### Visual Design
- **Color Coding** - Red gradient based on severity
- **Icons** - Threat-specific visual indicators
- **Animation** - Pulsing for active threats
- **Expiration** - Auto-remove after configurable time

## Real-time Features

### Live Monitoring
- **Configurable Intervals** - 60 seconds to 1 hour
- **Automatic Processing** - Continuous threat analysis
- **Real-time Alerts** - Instant notifications to field users
- **Team Broadcasting** - Only relevant team members receive alerts

### Socket.IO Events
- `threat:new` - New threat detected
- `threat:updated` - Threat information updated
- `threat:verified` - Threat verified by user
- `threat:expired` - Threat expired and removed

## Security & Privacy

### Data Protection
- **Encrypted Storage** - API credentials encrypted at rest
- **Team Isolation** - Data segregated by team
- **Access Control** - Admin-only configuration
- **Audit Logging** - Complete activity tracking

### Compliance
- **Data Retention** - Configurable retention policies
- **User Consent** - Clear data usage policies
- **API Limits** - Respect platform rate limits
- **Error Handling** - Graceful degradation on failures

## Monitoring & Analytics

### Dashboard Metrics
- **Total Threats** - Overall threat count
- **Threat Levels** - Breakdown by severity
- **Threat Types** - Categorization analysis
- **Posts Analyzed** - Processing volume
- **Response Times** - System performance

### Statistics
- **Daily Trends** - Threat patterns over time
- **Geographic Distribution** - Location-based analysis
- **Source Analysis** - Author credibility assessment
- **False Positive Rates** - System accuracy metrics

## API Endpoints

### Monitor Management
- `GET /api/social-media/monitors` - List all monitors
- `POST /api/social-media/monitors` - Create new monitor
- `PUT /api/social-media/monitors/:id` - Update monitor
- `DELETE /api/social-media/monitors/:id` - Delete monitor
- `POST /api/social-media/monitors/:id/start` - Start monitoring
- `POST /api/social-media/monitors/:id/stop` - Stop monitoring

### AI Configuration
- `GET /api/social-media/ai-config` - Get AI settings
- `POST /api/social-media/ai-config` - Create AI config
- `PUT /api/social-media/ai-config/:id` - Update AI config
- `POST /api/social-media/test-ai` - Test AI connection

### Threat Management
- `GET /api/social-media/threats` - List threats
- `GET /api/social-media/threats/statistics` - Get statistics
- `GET /api/social-media/threat-annotations` - Get map annotations
- `POST /api/social-media/threat-annotations/:id/verify` - Verify threat

### Testing
- `POST /api/social-media/test-connection` - Test Twitter API

## Cost Analysis

### Cost Optimization
- **Smart Filtering** - Reduce unnecessary API calls
- **Batch Processing** - Group similar requests
- **Caching** - Store frequently accessed data
- **Rate Limiting** - Respect platform limits

## Troubleshooting

### Common Issues

1. **API Connection Failed**
   - Verify API keys are correct
   - Check rate limits
   - Ensure network connectivity

2. **No Threats Detected**
   - Review search query syntax
   - Check monitoring interval
   - Verify AI configuration

3. **High False Positive Rate**
   - Adjust AI temperature setting
   - Refine search queries
   - Update threat keywords

4. **Performance Issues**
   - Reduce monitoring frequency
   - Optimize search queries
   - Scale infrastructure

### Debug Mode
Enable debug logging by setting:
```bash
DEBUG=social-media:*
```

## Resources

### Documentation
- [Twitter Advanced Search](https://github.com/igorbrigadir/twitter-advanced-search)
- [TwitterAPI.io Documentation](https://docs.twitterapi.io)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [TAK-Lite Architecture](./ARCHITECTURE.md)