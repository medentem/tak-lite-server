# TAK Lite Server

Cloud-native backend for TAK Lite. Purpose-built to bridge disconnected meshes and provide online visibility for teams using the TAK Lite app. Includes first‑run setup, authentication, real‑time sync, and a lightweight admin dashboard. This repository is published at [medentem/tak-lite-server](https://github.com/medentem/tak-lite-server).

## 🚀 Quick Start

### One-liner (default minimal stack)

```bash
docker compose up -d
```

Then visit `http://localhost:3000/setup` and complete the on‑page setup form (no env vars needed with Docker Compose). If you prefer the API, you can still POST to `/api/setup/complete` with the same fields.

Health: `GET /health` — Metrics: `GET /metrics` (public before setup; admin‑token required after setup)

Optional profiles (examples):
- Redis: `docker compose --profile redis up -d`
- Nginx/TLS: `docker compose --profile nginx up -d`
- Monitoring: `docker compose --profile monitoring up -d` (requires adding your own Prometheus/Grafana configs)

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
- Redis profile: set `REDIS_PASSWORD` in a local `.env` file (not committed) before enabling `--profile redis`. An `.env.example` is provided.

### Admin Dashboard

- URL: `http://localhost:3000/admin`
- Sign in with the admin email/password you set during setup (no manual JWT pasting).
- Panels included:
  - Overview KPIs (users, teams, socket connections, uptime, load, memory)
  - Configuration editor (organization name, CORS origin)
  - Socket rooms summary
  - Stats API: `GET /api/admin/stats` (requires admin token)

### REST API (current)

- POST `/api/setup/complete` — Complete first-run setup
  - Body: `{ adminEmail, adminPassword, orgName, corsOrigin? }`
- POST `/api/auth/login` — Obtain JWT (per-user credentials)
  - Body: `{ email, password }` → `{ token }`
- GET `/api/auth/whoami` — Validate token and return identity
- GET `/api/admin/config` — Read config (admin)
- PUT `/api/admin/config` — Update `{ orgName, corsOrigin }` (admin)
- GET `/api/admin/stats` — Summary stats (admin)
- POST `/api/sync/location` — Save location (auth)
  - Body: `{ teamId(uuid), latitude, longitude, altitude?, accuracy?, timestamp(ms) }`
- POST `/api/sync/annotation` — Upsert annotation (auth)
  - Body: `{ teamId(uuid), annotationId?(uuid), type, data(object) }`
- POST `/api/sync/message` — Create message (auth)
  - Body: `{ teamId(uuid), messageType('text'), content }`

### Socket.IO Events (current)

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

Rooms & membership:
- Clients should call `team:join` with a valid `teamId` after authenticating. The server enforces team membership on all REST and WebSocket actions.

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
# Prereqs: set DATABASE_URL (e.g., in a .env file). Example:
# DATABASE_URL=postgresql://taklite:taklite@localhost:5432/taklite

# Install dependencies
npm install

# Run migrations (the server also runs migrations on startup)
npm run db:migrate

# Start development server (ts-node via nodemon)
npm run dev

# Build for production
npm run build
npm start
```

## 🏗️ Architecture

### Implemented Components (current)

- **HTTP API**: Express.js endpoints
- **Auth**: Email/password → JWT
- **Sync Service**: Real-time data + Socket.IO gateway
- **Database**: PostgreSQL + Knex migrations
- **Setup Wizard**: First‑run configuration (`/setup`)
- **Admin Dashboard**: Lightweight UI (`/admin`)

### Data Flow

```
TAK Lite Client ←→ WebSocket ←→ Sync Service ←→ Database
                     ↓
                API Gateway ←→ Web Dashboard
                     ↓
                Authentication Service
```

## 🔧 Configuration

### Environment Variables (bare‑metal)

```bash
# Required
DATABASE_URL=postgresql://taklite:taklite@localhost:5432/taklite

# Optional
LOG_LEVEL=info
CORS_ORIGIN=https://your-domain.com
PORT=3000
```

### Docker Compose Services (minimal)

```yaml
services:
  taklite-server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - postgres

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: taklite
      POSTGRES_USER: taklite
      POSTGRES_PASSWORD: taklite
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## 📊 Features (implemented)

- Real-time sync: locations, annotations, messages
- Team membership enforcement for all actions
- Socket rooms per team; `team:join`/`team:leave`
- Admin Dashboard at `/admin`
- Setup Wizard at `/setup`
- Metrics endpoint at `/metrics` (admin‑protected after setup)

### Security (current)
- JWT-based authentication (email/password → JWT)
- Rate limiting on `/api/*` and dedicated limiter on `/api/auth/login`
- Admin-only routes and metrics after setup

### Scalability (notes)
- Horizontal scaling requires a Socket.IO Redis adapter and sticky sessions (not bundled)

## 🔌 API Reference (selected)

### Authentication

```bash
# Login
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password"
}

# Who am I
GET /api/auth/whoami
Authorization: Bearer <token>
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

- Prometheus‑style metrics at `/metrics`
- Compose profile examples for Prometheus/Grafana are provided but require you to supply config files

## 🔒 Security (summary)

- JWT tokens verified in REST and Socket.IO
- Admin‑only routes under `/api/admin`
- Rate limiting on `/api/*` and login endpoint
- CORS configurable via Admin UI

## 🚀 Deployment & Ops

### Production notes
- Behind a reverse proxy (Caddy/Nginx) is recommended for TLS
- Socket.IO horizontal scaling requires a Redis adapter and sticky sessions (not bundled)

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

This project is licensed under the GPL‑3.0 License — see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Donate**: [Github Sponsors](https://github.com/sponsors/medentem)
- **Issues**: [GitHub Issues](https://github.com/medentem/tak-lite-server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/medentem/tak-lite-server/discussions)
- **Email**: support@taklite.com

## 🔐 Secret exposure remediation

If you accidentally committed a secret (e.g., Redis password):
- Rotate it immediately (change the value wherever it’s used).
- Remove it from Git history and force‑push:
```bash
git filter-repo --path docker-compose.yml --invert-paths --force || true
git commit -am "Remove hardcoded secret"
git push --force
```
Or use GitHub’s “Remove from history” guidance and re‑push. Then add the secret via environment variables or a `.env` file that’s ignored by Git.
