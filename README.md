# TAK Lite Server

Cloud-native backend for TAK Lite. Purpose-built to bridge disconnected meshes and provide online visibility for teams using the TAK Lite app. Includes first‑run setup, authentication, real‑time sync, and a lightweight admin dashboard.

# How it works

TAK-Lite Server provides an internet-enabled synchronization backbone for all TAK-Lite clients, and provides command and control capabilities to a desktop-based operator interacting with the server-side dashboard. Clients still benefit from the mesh network synchronization in the field, but get additional situational awareness from a remote operator monitoring the operating area. 

![tak-lite-server-overview](https://github.com/user-attachments/assets/4e7ba63a-373e-4d65-a975-f648da8bdf91)

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/medentem/tak-lite-server/tree/main&refcode=6be1d132f60d)

> **Recommended**: The "Deploy to DO" button provides the fastest setup with a Dev Database including SSL certificates. For production databases with monitoring alerts, use Option 3 below.

## Quick Start (Local Development)

### Run with Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/medentem/tak-lite-server.git
cd tak-lite-server

# Start the application
docker compose up -d

# Complete setup
open http://localhost:3000/setup
```

### Run Manually

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database URL

# Run migrations
npm run db:migrate

# Start development server
npm run dev
```

## Features

- **Admin Dashboard**: `http://localhost:3000/admin` - Complete admin interface
- **Setup Wizard**: `http://localhost:3000/setup` - First-run configuration
- **Real-time Sync**: WebSocket-based location, annotation, and message sync
- **REST API**: Full API for authentication, sync, and admin operations
- **Health Monitoring**: `GET /health` and `GET /metrics` endpoints

## API Reference

### Authentication
```bash
# Login
POST /api/auth/login
{ "email": "user@example.com", "password": "password" }

# Get user info
GET /api/auth/whoami
Authorization: Bearer <token>
```

### Real-time Sync
```bash
# Send location update
POST /api/sync/location
{
  "teamId": "uuid",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "timestamp": 1640995200000
}
```

### WebSocket Events
```javascript
// Connect and authenticate
const socket = io('http://localhost:3000', {
  auth: { token: 'your-jwt-token' }
});

// Join a team room for real-time updates
socket.emit('team:join', 'team-uuid');

// Send location update (broadcasts to team room)
socket.emit('location:update', {
  teamId: 'uuid',
  latitude: 37.7749,
  longitude: -122.4194,
  timestamp: Date.now()
});

// Listen for real-time updates from team members
socket.on('location:update', (data) => {
  console.log('Team member location:', data);
});

// Listen for admin events (admin users only)
socket.on('admin:stats_update', (stats) => {
  console.log('Live server stats:', stats);
});
```

### API Integration Example

Here's how the REST API and WebSocket service work together:

```javascript
// 1. Initial app startup - use REST API for data sync
const response = await fetch('/api/sync/locations/last?teamId=uuid', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const lastLocations = await response.json();

// 2. Connect to WebSocket for real-time updates
const socket = io('http://localhost:3000', { auth: { token } });
socket.emit('team:join', 'uuid');

// 3. Send updates via WebSocket (preferred for real-time)
socket.emit('location:update', { teamId: 'uuid', latitude: 37.7749, longitude: -122.4194 });

// 4. Fallback to REST API if WebSocket fails
socket.on('disconnect', async () => {
  // Queue updates and sync via REST when reconnected
  await fetch('/api/sync/location', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId: 'uuid', latitude: 37.7749, longitude: -122.4194 })
  });
});
```

## Architecture

### Dual API Architecture

TAK Lite Server provides **both REST API and WebSocket services** that work together to support different client needs:

#### **REST API** (`/api/*`)
- **Purpose**: Initial sync, offline support, and traditional API operations
- **Authentication**: JWT tokens in `Authorization: Bearer <token>` header
- **Rate Limiting**: 120 requests/minute per IP
- **Use Cases**: 
  - App startup and initial data sync
  - Offline operation with batch sync
  - Admin operations and configuration
  - Health checks and monitoring

#### **WebSocket Service** (Socket.IO)
- **Purpose**: Real-time updates and live collaboration
- **Authentication**: JWT tokens in connection auth or headers
- **Team Rooms**: Dynamic team-based communication channels
- **Use Cases**:
  - Live location tracking
  - Real-time annotation updates
  - Instant messaging
  - Admin dashboard live monitoring

#### **Shared Business Logic**
Both APIs use the same `SyncService` for core operations:
- Location updates → Database storage + team broadcasting
- Annotation management → Validation + real-time sync
- Message handling → Team-based communication
- Team operations → Membership validation

#### **Real-time Features**
- **Team Rooms**: Clients join `team:${teamId}` rooms for team-specific updates
- **Admin Monitoring**: Live statistics and connection tracking
- **Broadcast Updates**: Changes are instantly pushed to all team members
- **Connection Management**: Automatic reconnection and authentication

### Technical Stack
- **HTTP API**: Express.js with JWT authentication
- **Real-time Sync**: Socket.IO for live location/annotation updates
- **Database**: PostgreSQL with automatic migrations
- **Admin Interface**: Modular ES6-based dashboard with component architecture
  - Page modules: Dashboard, Settings, Management, Threats, Messages
  - Shared utilities and services for code reuse
  - Modular CSS structure for maintainability
- **Security**: Rate limiting, CORS, and admin-only routes

## Deployment

### Option 1: One-Click Deploy (Recommended)

**Perfect for**: Most users who want the fastest setup

1. **Click the "Deploy to DO" button above** (or use this link: [Deploy to DigitalOcean](https://cloud.digitalocean.com/apps/new?repo=https://github.com/medentem/tak-lite-server/tree/main&refcode=6be1d132f60d))
2. **Follow the setup wizard** in DigitalOcean
3. **Complete setup** at `https://your-app-url.ondigitalocean.app/setup`

**Cost**: $20/month | **Time**: 2 minutes | **Features**: Dev Database with SSL certificates

### Option 2: Manual App Platform Setup

**Perfect for**: Users who want more control over the deployment

1. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
2. Click **"Create App"** → Connect GitHub → Select your repository
3. **Configure Service**: Dockerfile, Port 3000, Basic plan ($5/month)
4. **Add Database**: PostgreSQL, Basic plan ($15/month)
5. **Set Environment Variables**:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = `your-secret-key-here`
   - `CORS_ORIGIN` = `*`
6. **Deploy** and wait 5-10 minutes
7. **Complete Setup**: Visit `https://your-app-url.ondigitalocean.app/setup`

**Cost**: $27/month | **Time**: 10 minutes | **Features**: All essential features included

### Option 3: Advanced CLI Deployment

**Perfect for**: Technical users who need monitoring alerts and custom configurations

```bash
# Install doctl CLI
brew install doctl  # macOS
# or: snap install doctl  # Linux

# Authenticate
doctl auth init

# Deploy with full features (monitoring alerts, custom ingress)
./deploy-with-doctl.sh
```

**Cost**: $27/month | **Time**: 5 minutes | **Features**: All features including monitoring alerts

### Option 4: Self-Hosted Droplet

**Perfect for**: Users who want full control and lower costs

```bash
# Create a DigitalOcean Droplet (Ubuntu 22.04, 2GB RAM minimum)
# SSH into your droplet
ssh root@your-droplet-ip

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh

# Clone and deploy
git clone https://github.com/medentem/tak-lite-server.git
cd tak-lite-server
docker compose up -d

# Complete setup at http://your-droplet-ip:3000/setup
```

**Cost**: $12/month | **Time**: 30 minutes | **Features**: Full control, manual SSL setup needed

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `development` | Environment mode |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `JWT_SECRET` | Yes | - | Secret for JWT token signing |
| `JWT_EXPIRES_IN` | No | `7d` | JWT token expiration |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origins |
| `LOG_LEVEL` | No | `info` | Logging level |
| `PORT` | No | `3000` | Server port |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the GPL‑3.0 License — see the [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/medentem/tak-lite-server/issues)
