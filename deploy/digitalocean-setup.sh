#!/bin/bash

# DigitalOcean Droplet Setup Script for TAK Lite Server
# This script automates the initial server setup for DigitalOcean deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_USER="taklite"
APP_DIR="/home/$APP_USER/tak-lite-server"
DOMAIN=""
EMAIL=""

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root"
   exit 1
fi

# Get user input
read -p "Enter your domain name (e.g., taklite.example.com): " DOMAIN
read -p "Enter your email for SSL certificates: " EMAIL

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
    log_error "Domain and email are required"
    exit 1
fi

log_info "Starting DigitalOcean setup for domain: $DOMAIN"

# Update system
log_info "Updating system packages..."
apt update && apt upgrade -y

# Install essential packages
log_info "Installing essential packages..."
apt install -y curl wget git unzip software-properties-common apt-transport-https ca-certificates gnupg lsb-release

# Install Docker
log_info "Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
rm get-docker.sh

# Install Docker Compose
log_info "Installing Docker Compose..."
apt install -y docker-compose-plugin

# Create application user
log_info "Creating application user: $APP_USER"
if ! id "$APP_USER" &>/dev/null; then
    adduser --disabled-password --gecos "" $APP_USER
    usermod -aG docker $APP_USER
    log_success "User $APP_USER created and added to docker group"
else
    log_warning "User $APP_USER already exists"
fi

# Install Nginx
log_info "Installing Nginx..."
apt install -y nginx

# Install Certbot for SSL
log_info "Installing Certbot..."
apt install -y certbot python3-certbot-nginx

# Create Nginx configuration
log_info "Creating Nginx configuration..."
cat > /etc/nginx/sites-available/tak-lite << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
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
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/tak-lite /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# Start and enable services
systemctl start nginx
systemctl enable nginx

# Create application directory
log_info "Setting up application directory..."
sudo -u $APP_USER mkdir -p $APP_DIR

# Create environment file template
log_info "Creating environment file template..."
cat > $APP_DIR/.env.template << EOF
# TAK Lite Server Environment Configuration
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://taklite:taklite@postgres:5432/taklite

# Security
JWT_SECRET=CHANGE_THIS_TO_A_SECURE_RANDOM_STRING
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=https://$DOMAIN

# Logging
LOG_LEVEL=info

# Optional: Redis (uncomment if using Redis profile)
# REDIS_PASSWORD=CHANGE_THIS_TO_A_SECURE_REDIS_PASSWORD

# Optional: RabbitMQ (uncomment if using MQ profile)
# RABBITMQ_URL=amqp://taklite:taklite@rabbitmq:5672/
EOF

# Create deployment script
log_info "Creating deployment script..."
cat > $APP_DIR/deploy.sh << 'EOF'
#!/bin/bash

# TAK Lite Server Deployment Script
set -e

APP_DIR="/home/taklite/tak-lite-server"
REPO_URL="https://github.com/your-username/tak-lite-server.git"

log_info() {
    echo -e "\033[0;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

log_error() {
    echo -e "\033[0;31m[ERROR]\033[0m $1"
}

cd $APP_DIR

# Check if .env exists
if [ ! -f .env ]; then
    log_error ".env file not found. Please copy .env.template to .env and configure it."
    exit 1
fi

# Pull latest code
log_info "Pulling latest code..."
git pull origin main

# Build and start services
log_info "Building and starting services..."
docker compose down
docker compose build --no-cache
docker compose up -d

# Wait for services to be healthy
log_info "Waiting for services to be healthy..."
sleep 30

# Check service status
log_info "Checking service status..."
docker compose ps

# Test health endpoint
log_info "Testing health endpoint..."
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    log_success "Health check passed"
else
    log_error "Health check failed"
    docker compose logs taklite-server
    exit 1
fi

log_success "Deployment completed successfully!"
EOF

chmod +x $APP_DIR/deploy.sh
chown $APP_USER:$APP_USER $APP_DIR/deploy.sh

# Create backup script
log_info "Creating backup script..."
cat > $APP_DIR/backup.sh << 'EOF'
#!/bin/bash

# TAK Lite Server Backup Script
set -e

BACKUP_DIR="/home/taklite/backups"
DATE=$(date +%Y%m%d_%H%M%S)
APP_DIR="/home/taklite/tak-lite-server"

log_info() {
    echo -e "\033[0;34m[INFO]\033[0m $1"
}

log_success() {
    echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

mkdir -p $BACKUP_DIR

cd $APP_DIR

log_info "Starting backup process..."

# Backup database
log_info "Backing up database..."
docker compose exec -T postgres pg_dump -U taklite taklite > $BACKUP_DIR/db_$DATE.sql

# Backup uploads
if [ -d "uploads" ]; then
    log_info "Backing up uploads..."
    tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz uploads/
fi

# Backup logs
if [ -d "logs" ]; then
    log_info "Backing up logs..."
    tar -czf $BACKUP_DIR/logs_$DATE.tar.gz logs/
fi

# Keep only last 7 days of backups
log_info "Cleaning up old backups..."
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

log_success "Backup completed: $BACKUP_DIR"
EOF

chmod +x $APP_DIR/backup.sh
chown $APP_USER:$APP_USER $APP_DIR/backup.sh

# Set up cron jobs
log_info "Setting up cron jobs..."
(crontab -u $APP_USER -l 2>/dev/null; echo "0 2 * * * $APP_DIR/backup.sh") | crontab -u $APP_USER -

# Configure firewall
log_info "Configuring firewall..."
ufw --force enable
ufw allow ssh
ufw allow 'Nginx Full'
ufw allow 3000

# Create systemd service for monitoring
log_info "Creating systemd service for monitoring..."
cat > /etc/systemd/system/tak-lite-monitor.service << EOF
[Unit]
Description=TAK Lite Server Monitor
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
ExecStart=/bin/bash -c 'docker compose up -d'
ExecStop=/bin/bash -c 'docker compose down'
User=$APP_USER
Group=$APP_USER

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable tak-lite-monitor.service

log_success "DigitalOcean setup completed!"
echo ""
log_info "Next steps:"
echo "1. Clone your repository:"
echo "   sudo -u $APP_USER git clone https://github.com/your-username/tak-lite-server.git $APP_DIR"
echo ""
echo "2. Configure environment:"
echo "   sudo -u $APP_USER cp $APP_DIR/.env.template $APP_DIR/.env"
echo "   sudo -u $APP_USER nano $APP_DIR/.env"
echo ""
echo "3. Deploy the application:"
echo "   sudo -u $APP_USER $APP_DIR/deploy.sh"
echo ""
echo "4. Get SSL certificate:"
echo "   certbot --nginx -d $DOMAIN --email $EMAIL --agree-tos --non-interactive"
echo ""
echo "5. Test your deployment:"
echo "   curl https://$DOMAIN/health"
echo ""
log_warning "Don't forget to:"
echo "- Update the repository URL in deploy.sh"
echo "- Configure your .env file with secure secrets"
echo "- Set up DNS records to point to this server"
echo "- Test the SSL certificate renewal: certbot renew --dry-run"
