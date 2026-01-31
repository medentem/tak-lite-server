# TAK Lite Server - Advanced Deployment Guide

This directory contains deployment configurations and scripts for various platforms.

**📖 For non-technical users**: See the [Simple Deployment Guide](../DEPLOYMENT-SIMPLE.md)  
**🤔 Not sure which method to choose?**: See the [Deployment Decision Guide](../DEPLOYMENT-DECISION.md)

## 📁 Directory Structure

```
deploy/
├── README.md                    # This file
├── digitalocean-setup.sh        # Automated DigitalOcean Droplet setup
├── .do/
│   └── app.yaml                 # DigitalOcean App Platform configuration
└── kubernetes/
    ├── values.yaml              # Helm values for Kubernetes deployment
    └── secrets.yaml             # Kubernetes secrets template
```

## 🚀 Deployment Options

### 1. DigitalOcean App Platform (Easiest)

**Best for**: Quick deployment, managed infrastructure, automatic scaling

1. **Prepare your repository**:
   ```bash
   # Ensure your code is in a Git repository
   git add .
   git commit -m "Prepare for DigitalOcean deployment"
   git push origin main
   ```

2. **Deploy via App Platform**:
   - Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
   - Click "Create App" → "GitHub" → Select your repository
   - Use the configuration from `.do/app.yaml`
   - Set environment variables in the UI (e.g. `JWT_SECRET`; optionally `SETUP_SECRET` for secure first-time setup)
   - Deploy!

**Configuration**: See `.do/app.yaml` for complete configuration. To prevent anyone who finds your app URL from completing setup before you do, set **SETUP_SECRET** (as a secret) in the app's environment; then open `/setup` and enter that value in the "Setup Key" field (or use a claim link: `/setup?key=your-secret`).

### 2. DigitalOcean Droplets with Docker (Most Control)

**Best for**: Full control, cost-effective, custom configurations

1. **Create a Droplet**:
   - Ubuntu 22.04 LTS
   - Minimum: 2GB RAM, 1 vCPU, 50GB SSD
   - Recommended: 4GB RAM, 2 vCPU, 80GB SSD

2. **Run the setup script**:
   ```bash
   # Download and run the setup script
   curl -fsSL https://raw.githubusercontent.com/medentem/tak-lite-server/main/deploy/digitalocean-setup.sh | bash
   
   # Or download and run manually
   wget https://raw.githubusercontent.com/medentem/tak-lite-server/main/deploy/digitalocean-setup.sh
   chmod +x digitalocean-setup.sh
   sudo ./digitalocean-setup.sh
   ```

3. **Follow the post-setup instructions** displayed by the script.

**Features of the setup script**:
- ✅ Installs Docker and Docker Compose
- ✅ Sets up Nginx reverse proxy
- ✅ Configures SSL with Let's Encrypt
- ✅ Creates application user and directories
- ✅ Sets up automated backups
- ✅ Configures firewall
- ✅ Creates monitoring and deployment scripts

### 3. DigitalOcean Kubernetes (Advanced)

**Best for**: High availability, auto-scaling, microservices

1. **Create a Kubernetes cluster**:
   ```bash
   # Using doctl CLI
   doctl kubernetes cluster create tak-lite-cluster \
     --region nyc1 \
     --version 1.28.2-do.0 \
     --node-pool "name=worker-pool;size=s-2vcpu-4gb;count=2"
   ```

2. **Install Helm**:
   ```bash
   curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
   ```

3. **Deploy with Helm**:
   ```bash
   # Create secrets
   kubectl create secret generic tak-lite-secrets \
     --from-literal=JWT_SECRET="your-secure-jwt-secret" \
     --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/db" \
     --from-literal=CORS_ORIGIN="https://your-domain.com"
   
   # Deploy (you'll need to create a Helm chart)
   helm install tak-lite ./helm-chart -f deploy/kubernetes/values.yaml
   ```

## 🔧 Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Set to `production` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT token signing |
| `CORS_ORIGIN` | No | Allowed CORS origins |
| `LOG_LEVEL` | No | Logging level (default: `info`) |
| `PORT` | No | Server port (default: `3000`) |

### Security Considerations

1. **Generate secure secrets**:
   ```bash
   # JWT Secret
   openssl rand -base64 32
   
   # Redis Password
   openssl rand -base64 16
   ```

2. **Use managed databases** for production:
   - DigitalOcean Managed PostgreSQL
   - DigitalOcean Managed Redis

3. **Enable SSL/TLS**:
   - Let's Encrypt certificates (automatic with setup script)
   - App Platform includes SSL by default

4. **Configure firewall**:
   - Only allow necessary ports (22, 80, 443)
   - Block direct access to application port (3000)

## 📊 Monitoring

### Health Checks

All deployments include health check endpoints:
- `GET /health` - Basic health check
- `GET /metrics` - Prometheus metrics (admin-only after setup)

### Logging

- Application logs: `/app/logs` (Docker) or container logs (Kubernetes)
- Nginx logs: `/var/log/nginx/` (Droplet deployment)
- System logs: `journalctl -u tak-lite-monitor` (Droplet deployment)

### Backup

Automated backups are configured for Droplet deployments:
- Database backups: Daily at 2 AM
- File uploads: Daily at 2 AM
- Retention: 7 days
- Location: `/home/taklite/backups/`

## 🔄 Updates and Maintenance

### Droplet Deployment

```bash
# Update application
sudo -u taklite /home/taklite/tak-lite-server/deploy.sh

# Update system packages
sudo apt update && sudo apt upgrade -y

# Restart services
sudo systemctl restart tak-lite-monitor
```

### App Platform

Updates are automatic when you push to the configured branch.

### Kubernetes

```bash
# Update deployment
helm upgrade tak-lite ./helm-chart -f deploy/kubernetes/values.yaml

# Scale deployment
kubectl scale deployment tak-lite-server --replicas=3
```

## 🆘 Troubleshooting

### Common Issues

1. **Health check failing**:
   ```bash
   # Check logs
   docker compose logs taklite-server
   
   # Check database connection
   docker compose exec postgres psql -U taklite -d taklite -c "SELECT 1;"
   ```

2. **SSL certificate issues**:
   ```bash
   # Test certificate renewal
   sudo certbot renew --dry-run
   
   # Check certificate status
   sudo certbot certificates
   ```

3. **High memory usage**:
   ```bash
   # Check memory usage
   docker stats
   
   # Restart services
   docker compose restart
   ```

### Support

- **Documentation**: [README.md](../README.md)
- **Issues**: [GitHub Issues](https://github.com/medentem/tak-lite-server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/medentem/tak-lite-server/discussions)

## 📝 Customization

### Custom Domains

#### DNS Configuration

**For Droplet Deployment:**
1. **Before running setup script**:
   - Point your domain's A record to the droplet's IP address
   - Example DNS records:
     ```
     A     @           your-droplet-ip        # Root domain
     A     api         your-droplet-ip        # API subdomain  
     A     taklite     your-droplet-ip        # App subdomain
     CNAME www         your-domain.com        # WWW redirect
     ```
   - Wait for DNS propagation (can take up to 48 hours)

2. **Run setup script with your domain**:
   ```bash
   sudo ./digitalocean-setup.sh
   # Enter your domain when prompted
   ```

3. **Verify DNS resolution**:
   ```bash
   nslookup your-domain.com
   dig your-domain.com
   ```

**For App Platform:**
1. Go to Settings → Domains in your App Platform dashboard
2. Add your custom domain
3. Follow the DNS instructions provided by DigitalOcean
4. Update `CORS_ORIGIN` environment variable

**For Kubernetes:**
1. Get your LoadBalancer IP:
   ```bash
   kubectl get services
   ```
2. Point your domain's A record to the LoadBalancer IP
3. Update ingress configuration with your domain

#### SSL Certificate Management

**Droplets (Let's Encrypt):**
```bash
# Check certificate status
sudo certbot certificates

# Test renewal
sudo certbot renew --dry-run

# Manual renewal if needed
sudo certbot renew
```

**App Platform:** Automatic SSL certificates

**Kubernetes (cert-manager):**
```bash
# Check certificate status
kubectl get certificates
kubectl describe certificate your-domain-tls
```

#### Domain Testing

```bash
# Test HTTP (should redirect to HTTPS)
curl -I http://your-domain.com

# Test HTTPS
curl -I https://your-domain.com/health

# Test API endpoints
curl -I https://your-domain.com/api/auth/whoami
```

### Scaling

- **App Platform**: Automatic scaling based on traffic
- **Droplets**: Manual scaling with load balancer
- **Kubernetes**: Horizontal Pod Autoscaler (HPA)

### Additional Services

Enable additional services using Docker Compose profiles:
```bash
# Redis for caching
docker compose --profile redis up -d

# Monitoring stack
docker compose --profile monitoring up -d

# Message queue
docker compose --profile mq up -d
```
