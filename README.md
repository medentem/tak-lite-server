# TAK Lite Server

A cloud-native backend server that bridges TAK Lite users across the internet, providing enhanced collaboration, real-time synchronization, and comprehensive monitoring capabilities.

## 🚀 Quick Start

### One-liner (default minimal stack)

```bash
docker compose up -d
```

Then visit `http://localhost:3000/setup` and complete setup via API:

```bash
curl -X POST http://localhost:3000/api/setup/complete \
  -H 'Content-Type: application/json' \
  -d '{
    "adminEmail": "you@example.com",
    "adminPassword": "change-me-strong",
    "orgName": "My Org",
    "corsOrigin": "http://localhost:3000"
  }'
```

Health: `GET /health` — Metrics: `GET /metrics`

Optional profiles:
- Redis: `docker compose --profile redis up -d`
- Nginx/TLS: `docker compose --profile nginx up -d`
- Monitoring: `docker compose --profile monitoring up -d`

### Docker Desktop (GUI)

1. Ensure Docker Desktop is running (macOS/Windows).
2. Clone this repo and open the folder in your file explorer.
3. In Docker Desktop:
   - Go to "Containers" (or "Containers/Apps").
   - Click "Create" → "From Compose file" (or "Add Stack" on older versions).
   - Select `tak-lite-server/docker-compose.yml` from this project.
   - Keep default settings and click "Create/Deploy".
4. Wait until both containers are healthy (`taklite-server`, `taklite-postgres`).
5. Open `http://localhost:3000/setup` in your browser and complete the setup wizard.

Notes:
- No environment variables are required when using Docker Desktop; the compose file wires Postgres and the server automatically.
- The server applies database migrations on first boot.
- To view logs: open the `taklite-server` container in Docker Desktop → Logs.
- To stop or restart, use the Docker Desktop controls on the stack/containers.

### REST API

- POST `/api/setup/complete` — Complete first-run setup
  - Body: `{ adminEmail, adminPassword, orgName, corsOrigin? }`
- POST `/api/auth/login` — Obtain JWT
  - Body: `{ email, password }` → `{ token }`
- GET `/api/admin/config` — Read config (admin)
- PUT `/api/admin/config` — Update `{ orgName, corsOrigin }` (admin)
- POST `/api/sync/location` — Save location (auth)
  - Body: `{ teamId(uuid), latitude, longitude, altitude?, accuracy?, timestamp(ms) }`
- POST `/api/sync/annotation` — Upsert annotation (auth)
  - Body: `{ teamId(uuid), annotationId?(uuid), type, data(object) }`
- POST `/api/sync/message` — Create message (auth)
  - Body: `{ teamId(uuid), messageType('text'), content }`

### Socket.IO Events

- `authenticate` — Provide JWT to bind user to the socket
  - Payload: `token`
  - Response: `authenticated` → `{ success: true } | { success: false, error }`
- `location:update` — Broadcast location to team and persist
  - Payload: `{ teamId(uuid), latitude, longitude, altitude?, accuracy?, timestamp }`
- `annotation:update` — Upsert annotation and broadcast
  - Payload: `{ teamId(uuid), annotationId?(uuid), type, data }`
- `message:send` — Create message and broadcast
  - Payload: `{ teamId(uuid), messageType('text'), content }`
- Server broadcasts:
  - `location:update` → `{ userId, ...payload }`
  - `annotation:update` → annotation row
  - `message:received` → message row

### Minimal client example (Node/Browser)

```javascript
import io from 'socket.io-client';
import axios from 'axios';

const base = 'http://localhost:3000';

async function main() {
  // Login to get JWT
  const { data: auth } = await axios.post(base + '/api/auth/login', {
    email: 'you@example.com',
    password: 'your-password'
  });
  const token = auth.token;

  // Connect socket and authenticate
  const socket = io(base, { transports: ['websocket'] });
  socket.on('connect', () => socket.emit('authenticate', token));
  socket.on('authenticated', (res) => console.log('socket auth:', res));
  socket.on('location:update', (u) => console.log('location:', u));

  // Send a location update via REST
  await axios.post(
    base + '/api/sync/location',
    { teamId: 'TEAM-UUID', latitude: 37.77, longitude: -122.42, timestamp: Date.now() },
    { headers: { Authorization: 'Bearer ' + token } }
  );

  // Or via Socket.IO
  socket.emit('location:update', { teamId: 'TEAM-UUID', latitude: 37.77, longitude: -122.42, timestamp: Date.now() });
}

main();
```

### Manual Deployment

```bash
# Install dependencies
npm install

# Setup database
npm run db:migrate
npm run db:seed

# Start development server
npm run dev

# Build for production
npm run build
npm start
```

## 🏗️ Architecture

### Service Components

- **API Gateway**: Nginx-based reverse proxy with rate limiting and SSL termination
- **Authentication Service**: JWT-based auth with OAuth2 support
- **Sync Service**: Real-time data synchronization between TAK Lite clients
- **WebRTC Gateway**: Audio/video communication bridge
- **Analytics Service**: Data analysis and reporting
- **Notification Service**: Push notifications and alerts
- **Storage Service**: Data persistence and caching
- **Monitoring Service**: System health and performance monitoring

### Data Flow

```
TAK Lite Client ←→ WebSocket ←→ Sync Service ←→ Database
                     ↓
                API Gateway ←→ Web Dashboard
                     ↓
                Authentication Service
```

## 🔧 Configuration

### Environment Variables

```bash
# Server Configuration
SERVER_PORT=3000
NODE_ENV=production
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/taklite
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d
OAUTH_CLIENT_ID=your-oauth-client-id
OAUTH_CLIENT_SECRET=your-oauth-client-secret

# WebRTC
WEBRTC_ICE_SERVERS=stun:stun.l.google.com:19302

# Monitoring
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001

# Security
RATE_LIMIT_WINDOW=15m
RATE_LIMIT_MAX_REQUESTS=100
CORS_ORIGIN=https://your-domain.com
```

### Docker Compose Services

```yaml
version: '3.8'

services:
  # Main application
  taklite-server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - postgres
      - redis
      - rabbitmq

  # Database
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: taklite
      POSTGRES_USER: taklite
      POSTGRES_PASSWORD: taklite
    volumes:
      - postgres_data:/var/lib/postgresql/data

  # Cache
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  # Message Queue
  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"

  # Monitoring
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana_data:/var/lib/grafana

volumes:
  postgres_data:
  redis_data:
  grafana_data:
```

## 📊 Features

### Real-time Synchronization
- **Location Data**: Bridge GPS coordinates across all connected users
- **Annotations**: Sync POIs, lines, areas, and polygons in real-time
- **Messages**: Relay text and audio communications
- **State Management**: Handle conflicts and merge data from multiple sources

### Web Dashboard
- **User Management**: Administer users, teams, and permissions
- **Real-time Monitoring**: Live view of connected users and system health
- **Analytics**: Network usage, coverage analysis, and performance metrics
- **Configuration**: Server settings and feature management

### Security
- **End-to-end Encryption**: All data encrypted in transit and at rest
- **Authentication**: JWT-based auth with optional OAuth2 integration
- **Rate Limiting**: Protect against abuse and DDoS attacks
- **Audit Logging**: Complete trail of all user actions and system events

### Scalability
- **Horizontal Scaling**: Add more instances behind a load balancer
- **Database Sharding**: Distribute data across multiple database instances
- **Caching**: Redis-based caching for improved performance
- **Message Queues**: Asynchronous processing for high-throughput operations

## 🔌 API Reference

### Authentication

```bash
# Login
POST /api/auth/login
{
  "username": "user@example.com",
  "password": "password"
}

# Register
POST /api/auth/register
{
  "username": "user@example.com",
  "password": "password",
  "nickname": "User Nickname"
}
```

### Data Synchronization

```bash
# Send location update
POST /api/sync/location
{
  "latitude": 37.7749,
  "longitude": -122.4194,
  "timestamp": 1640995200000,
  "accuracy": 5
}

# Send annotation
POST /api/sync/annotation
{
  "type": "poi",
  "data": {
    "latitude": 37.7749,
    "longitude": -122.4194,
    "label": "Meeting Point",
    "color": "green"
  }
}
```

### WebSocket Events

```javascript
// Connect to real-time updates
const socket = io('https://your-server.com');

// Listen for location updates
socket.on('location:update', (data) => {
  console.log('Location update:', data);
});

// Listen for annotation updates
socket.on('annotation:update', (data) => {
  console.log('Annotation update:', data);
});

// Send location update
socket.emit('location:update', {
  latitude: 37.7749,
  longitude: -122.4194,
  timestamp: Date.now()
});
```

## 📈 Monitoring

### Metrics Dashboard
- **User Activity**: Active users, connections, and usage patterns
- **System Performance**: CPU, memory, disk, and network utilization
- **Database Performance**: Query times, connection pools, and cache hit rates
- **Network Health**: Latency, packet loss, and connection quality

### Alerts
- **High CPU/Memory Usage**: Automatic scaling triggers
- **Database Connection Issues**: Connection pool exhaustion alerts
- **Security Events**: Failed login attempts and suspicious activity
- **Service Health**: Service availability and response time monitoring

## 🔒 Security

### Data Protection
- **Encryption at Rest**: All data encrypted using AES-256
- **Encryption in Transit**: TLS 1.3 for all communications
- **Key Management**: Secure key storage and rotation
- **Data Retention**: Configurable data retention policies

### Access Control
- **Role-based Access**: Admin, user, and read-only roles
- **Team-based Permissions**: Granular access control per team
- **API Rate Limiting**: Prevent abuse and ensure fair usage
- **Audit Logging**: Complete trail of all access and modifications

## 🚀 Deployment

### Production Checklist

- [ ] SSL certificate configured
- [ ] Environment variables set
- [ ] Database migrations run
- [ ] Monitoring configured
- [ ] Backup strategy implemented
- [ ] Security policies applied
- [ ] Load balancer configured
- [ ] CDN setup (optional)

### Scaling

```bash
# Scale horizontally
docker-compose up -d --scale taklite-server=3

# Add load balancer
docker-compose up -d nginx

# Monitor scaling
docker-compose logs -f taklite-server
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [docs.taklite.com](https://docs.taklite.com)
- **Issues**: [GitHub Issues](https://github.com/your-org/tak-lite-server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/tak-lite-server/discussions)
- **Email**: support@taklite.com
