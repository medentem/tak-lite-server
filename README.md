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

## 🚀 Deployment

### Quick Start (Recommended for Most Users)

**🤔 Not sure which method to choose?** → [Deployment Decision Guide](DEPLOYMENT-DECISION.md)

**📖 [Simple Deployment Guide](DEPLOYMENT-SIMPLE.md)** - Step-by-step instructions for non-technical users

### Choose Your Deployment Method

**🎯 For Most Users**: [App Platform](#app-platform) - Just connect your GitHub repo and deploy!

**⚙️ For Technical Users**: [Droplet with Docker](#droplet-docker) - Full control over your server

**🏢 For Large Organizations**: [Kubernetes](#kubernetes) - Enterprise-grade scaling

---

## 📱 App Platform (Easiest - 5 minutes)

**Perfect for**: Small teams, quick setup, no server management needed

### Step 1: Prepare Your Code
1. Make sure your code is on GitHub
2. Note your repository URL (e.g., `https://github.com/yourusername/tak-lite-server`)

### Step 2: Deploy on DigitalOcean
1. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
2. Click **"Create App"**
3. Connect your **GitHub** account
4. Select your `tak-lite-server` repository
5. Click **"Next"**

### Step 3: Configure Your App
1. **App Name**: `tak-lite-server` (or whatever you prefer)
2. **Region**: Choose closest to your users
3. **Plan**: Start with **Basic** ($5/month)
4. Click **"Next"**

### Step 4: Add Database
1. Click **"Add Database"**
2. Choose **PostgreSQL**
3. Select **Basic** plan ($15/month)
4. Click **"Next"**

### Step 5: Set Environment Variables
Add these in the **Environment Variables** section:
- `NODE_ENV` = `production`
- `JWT_SECRET` = `your-secret-key-here` (generate a random string)
- `CORS_ORIGIN` = `https://your-domain.com` (if you have a custom domain)

### Step 6: Deploy!
1. Click **"Create Resources"**
2. Wait 5-10 minutes for deployment
3. Your app will be available at: `https://your-app-name-123456.ondigitalocean.app`

### Step 7: Complete Setup
1. Visit your app URL + `/setup` (e.g., `https://your-app-name-123456.ondigitalocean.app/setup`)
2. Fill out the setup form with:
   - Admin email
   - Admin password
   - Organization name
3. Click **"Complete Setup"**

**🎉 Done!** Your TAK Lite Server is now running!

### Optional: Custom Domain
1. In App Platform, go to **Settings** → **Domains**
2. Add your domain (e.g., `api.yourdomain.com`)
3. Follow the DNS instructions provided
4. Update `CORS_ORIGIN` environment variable to match your domain

---

## ⚙️ Droplet with Docker (Technical Users)

**Perfect for**: Technical teams who want full control and cost optimization

### Prerequisites
- Basic command line knowledge
- A domain name (optional but recommended)
- DigitalOcean account

1. **Create a Droplet**:
   ```bash
   # Create a new droplet (Ubuntu 22.04 LTS recommended)
   # Minimum specs: 2GB RAM, 1 vCPU, 50GB SSD
   # Recommended: 4GB RAM, 2 vCPU, 80GB SSD
   ```

2. **Configure DNS** (before running setup script):
   - Point your domain's A record to the droplet's IP address
   - Example DNS records:
     ```
     A     @           your-droplet-ip
     A     api         your-droplet-ip
     CNAME www         your-domain.com
     ```
   - Wait for DNS propagation (can take up to 48 hours)

3. **Initial server setup**:
   ```bash
   # SSH into your droplet
   ssh root@your-droplet-ip
   
   # Update system
   apt update && apt upgrade -y
   
   # Install Docker
   curl -fsSL https://get.docker.com -o get-docker.sh
   sh get-docker.sh
   
   # Install Docker Compose
   apt install docker-compose-plugin -y
   
   # Create app user
   adduser taklite
   usermod -aG docker taklite
   ```

4. **Deploy the application**:
   ```bash
   # Switch to taklite user
   su - taklite
   
   # Clone repository
   git clone https://github.com/medentem/tak-lite-server.git
   cd tak-lite-server
   
   # Create environment file
   cat > .env << EOF
   NODE_ENV=production
   JWT_SECRET=$(openssl rand -base64 32)
   CORS_ORIGIN=https://your-domain.com
   LOG_LEVEL=info
   REDIS_PASSWORD=$(openssl rand -base64 16)
   EOF
   
   # Start services
   docker compose up -d
   
   # Check status
   docker compose ps
   docker compose logs -f taklite-server
   ```

5. **Set up reverse proxy with Nginx**:
   ```bash
   # Install Nginx
   sudo apt install nginx -y
   
   # Create Nginx configuration
   sudo tee /etc/nginx/sites-available/tak-lite << EOF
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade \$http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host \$host;
           proxy_set_header X-Real-IP \$remote_addr;
           proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto \$scheme;
           proxy_cache_bypass \$http_upgrade;
       }
   }
   EOF
   
   # Enable site
   sudo ln -s /etc/nginx/sites-available/tak-lite /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

6. **Set up SSL with Let's Encrypt**:
   ```bash
   # Install Certbot
   sudo apt install certbot python3-certbot-nginx -y
   
   # Get SSL certificate
   sudo certbot --nginx -d your-domain.com
   
   # Test auto-renewal
   sudo certbot renew --dry-run
   ```

7. **Set up monitoring and backups**:
   ```bash
   # Create backup script
   cat > backup.sh << EOF
   #!/bin/bash
   BACKUP_DIR="/home/taklite/backups"
   DATE=\$(date +%Y%m%d_%H%M%S)
   
   mkdir -p \$BACKUP_DIR
   
   # Backup database
   docker compose exec -T postgres pg_dump -U taklite taklite > \$BACKUP_DIR/db_\$DATE.sql
   
   # Backup uploads
   tar -czf \$BACKUP_DIR/uploads_\$DATE.tar.gz uploads/
   
   # Keep only last 7 days of backups
   find \$BACKUP_DIR -name "*.sql" -mtime +7 -delete
   find \$BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
   EOF
   
   chmod +x backup.sh
   
   # Add to crontab
   (crontab -l 2>/dev/null; echo "0 2 * * * /home/taklite/backup.sh") | crontab -
   ```

#### Option 3: DigitalOcean Kubernetes (For advanced users)

**Pros**: High availability, auto-scaling, container orchestration  
**Cons**: Complex setup, requires Kubernetes knowledge  
**Best for**: Large-scale deployments, microservices architecture

1. **Create a Kubernetes cluster**:
   ```bash
   # Using doctl CLI
   doctl kubernetes cluster create tak-lite-cluster \
     --region nyc1 \
     --version 1.28.2-do.0 \
     --node-pool "name=worker-pool;size=s-2vcpu-4gb;count=2"
   ```

2. **Deploy with Helm**:
   ```bash
   # Install Helm
   curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
   
   # Create values.yaml
   cat > values.yaml << EOF
   replicaCount: 2
   
   image:
     repository: your-registry/tak-lite-server
     tag: latest
     pullPolicy: IfNotPresent
   
   service:
     type: ClusterIP
     port: 3000
   
   ingress:
     enabled: true
     className: nginx
     annotations:
       cert-manager.io/cluster-issuer: letsencrypt-prod
     hosts:
       - host: your-domain.com
         paths:
           - path: /
             pathType: Prefix
     tls:
       - secretName: tak-lite-tls
         hosts:
           - your-domain.com
   
   postgresql:
     enabled: true
     auth:
       postgresPassword: "secure-password"
       database: "taklite"
   
   redis:
     enabled: true
     auth:
       enabled: true
       password: "secure-redis-password"
   EOF
   
   # Deploy
   helm install tak-lite ./helm-chart -f values.yaml
   ```

### Production notes
- Behind a reverse proxy (Caddy/Nginx) is recommended for TLS
- Socket.IO horizontal scaling requires a Redis adapter and sticky sessions (not bundled)
- Use managed databases (DigitalOcean Managed PostgreSQL) for production
- Set up monitoring with DigitalOcean Monitoring or external services
- Configure log rotation and retention policies
- Use secrets management for sensitive environment variables

### Scaling

```bash
# Scale horizontally (Droplet deployment)
docker-compose up -d --scale taklite-server=3

# Add load balancer
docker-compose up -d nginx

# Monitor scaling
docker-compose logs -f taklite-server

# Kubernetes scaling
kubectl scale deployment tak-lite-server --replicas=5
```

## 📚 Advanced Configuration

### Custom Domains
For detailed DNS setup and SSL configuration, see the [Advanced Deployment Guide](deploy/README.md#custom-domains).

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | Yes | `development` | Environment mode |
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `JWT_SECRET` | Yes | - | Secret for JWT token signing |
| `JWT_EXPIRES_IN` | No | `7d` | JWT token expiration |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origins |
| `LOG_LEVEL` | No | `info` | Logging level |
| `PORT` | No | `3000` | Server port |
| `REDIS_URL` | No | - | Redis connection string |
| `RABBITMQ_URL` | No | - | RabbitMQ connection string |

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
