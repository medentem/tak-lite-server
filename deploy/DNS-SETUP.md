# DNS Configuration Guide for TAK Lite Server

This guide covers how to properly configure DNS records for your TAK Lite Server deployment on DigitalOcean.

## 🌐 DNS Record Types

### A Records
- Points a domain/subdomain to an IP address
- Used for root domain and subdomains

### CNAME Records  
- Points a domain/subdomain to another domain name
- Used for www redirects and aliases

### TXT Records
- Used for domain verification and SSL certificates
- Required by Let's Encrypt for domain validation

## 📋 DNS Configuration by Deployment Type

### Option 1: DigitalOcean App Platform

**Automatic Configuration:**
1. Go to your App Platform dashboard
2. Navigate to Settings → Domains
3. Click "Add Domain"
4. Enter your domain name
5. Follow the DNS instructions provided by DigitalOcean

**Manual Configuration:**
If you prefer to manage DNS manually:

```bash
# Get your App Platform domain from the dashboard
# Example: your-app-name-123456.ondigitalocean.app

# DNS records to add:
CNAME  @           your-app-name-123456.ondigitalocean.app
CNAME  www         your-app-name-123456.ondigitalocean.app
CNAME  api         your-app-name-123456.ondigitalocean.app
```

### Option 2: DigitalOcean Droplets

**Step 1: Get Your Droplet IP**
```bash
# From DigitalOcean dashboard or CLI
doctl compute droplet list

# Or from the droplet itself
curl -4 ifconfig.co
```

**Step 2: Configure DNS Records**
```bash
# Replace your-droplet-ip with your actual droplet IP address

# Root domain
A     @           your-droplet-ip

# Subdomains
A     api         your-droplet-ip
A     taklite     your-droplet-ip
A     admin       your-droplet-ip

# WWW redirect
CNAME www         your-domain.com

# Optional: Additional subdomains
A     staging     your-droplet-ip
A     dev         your-droplet-ip
```

**Step 3: Verify DNS Propagation**
```bash
# Check DNS resolution
nslookup your-domain.com
dig your-domain.com

# Check specific subdomains
nslookup api.your-domain.com
dig api.your-domain.com
```

### Option 3: DigitalOcean Kubernetes

**Step 1: Get LoadBalancer IP**
```bash
# Get the external IP of your LoadBalancer service
kubectl get services

# Example output:
# NAME           TYPE           CLUSTER-IP      EXTERNAL-IP     PORT(S)
# tak-lite-svc   LoadBalancer   10.245.123.45   157.230.123.45  80:30001/TCP,443:30002/TCP
```

**Step 2: Configure DNS Records**
```bash
# Replace your-loadbalancer-ip with the EXTERNAL-IP from above

# Root domain
A     @           your-loadbalancer-ip

# Subdomains  
A     api         your-loadbalancer-ip
A     taklite     your-loadbalancer-ip

# WWW redirect
CNAME www         your-domain.com
```

## 🔧 Common DNS Providers

### Cloudflare
1. Log into Cloudflare dashboard
2. Select your domain
3. Go to DNS → Records
4. Add the appropriate A/CNAME records
5. Enable "Proxy" for CDN benefits (optional)

### GoDaddy
1. Log into GoDaddy account
2. Go to My Products → DNS
3. Select your domain
4. Add/Edit DNS records
5. Save changes

### Namecheap
1. Log into Namecheap account
2. Go to Domain List → Manage
3. Go to Advanced DNS tab
4. Add/Edit DNS records
5. Save changes

### Route 53 (AWS)
1. Log into AWS Console
2. Go to Route 53 → Hosted Zones
3. Select your domain
4. Create Record
5. Add A/CNAME records

## ⏱️ DNS Propagation

**Timeline:**
- **Immediate**: Some DNS providers update instantly
- **5-15 minutes**: Most providers update within this timeframe
- **Up to 48 hours**: Full global propagation can take up to 48 hours

**Check Propagation:**
```bash
# Check from multiple locations
dig @8.8.8.8 your-domain.com
dig @1.1.1.1 your-domain.com
dig @208.67.222.222 your-domain.com

# Online tools
# https://www.whatsmydns.net/
# https://dnschecker.org/
```

## 🔒 SSL Certificate DNS Validation

### Let's Encrypt (Droplets)
When using Let's Encrypt, you may need to add TXT records for domain validation:

```bash
# Certbot will provide the TXT record during certificate generation
# Example:
TXT   _acme-challenge.your-domain.com    "abc123def456ghi789"

# After certificate is issued, you can remove this record
```

### App Platform
DigitalOcean handles SSL certificates automatically - no manual DNS configuration needed.

### Kubernetes (cert-manager)
cert-manager automatically handles DNS validation:

```yaml
# cert-manager will create temporary TXT records
# No manual intervention required
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: your-domain-tls
spec:
  secretName: your-domain-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - your-domain.com
  - api.your-domain.com
```

## 🧪 Testing Your DNS Configuration

### Basic Connectivity Tests
```bash
# Test HTTP (should redirect to HTTPS)
curl -I http://your-domain.com

# Test HTTPS
curl -I https://your-domain.com

# Test health endpoint
curl -I https://your-domain.com/health

# Test API endpoint
curl -I https://your-domain.com/api/auth/whoami
```

### SSL Certificate Tests
```bash
# Check certificate details
openssl s_client -connect your-domain.com:443 -servername your-domain.com

# Check certificate expiry
echo | openssl s_client -connect your-domain.com:443 -servername your-domain.com 2>/dev/null | openssl x509 -noout -dates
```

### Performance Tests
```bash
# Test response times
curl -w "@curl-format.txt" -o /dev/null -s https://your-domain.com/health

# Create curl-format.txt:
# time_namelookup:  %{time_namelookup}\n
# time_connect:     %{time_connect}\n
# time_appconnect:  %{time_appconnect}\n
# time_pretransfer: %{time_pretransfer}\n
# time_redirect:    %{time_redirect}\n
# time_starttransfer: %{time_starttransfer}\n
# time_total:       %{time_total}\n
```

## 🚨 Troubleshooting

### Common Issues

**1. DNS Not Propagating**
```bash
# Check if DNS is cached locally
sudo systemctl flush-dns  # Linux
sudo dscacheutil -flushcache  # macOS
ipconfig /flushdns  # Windows

# Check from different DNS servers
dig @8.8.8.8 your-domain.com
dig @1.1.1.1 your-domain.com
```

**2. SSL Certificate Issues**
```bash
# Check certificate status (Droplets)
sudo certbot certificates

# Test certificate renewal
sudo certbot renew --dry-run

# Check certificate chain
openssl s_client -connect your-domain.com:443 -servername your-domain.com -showcerts
```

**3. CORS Issues**
```bash
# Update CORS_ORIGIN environment variable
# For Droplets:
sudo -u taklite nano /home/taklite/tak-lite-server/.env
# Update: CORS_ORIGIN=https://your-domain.com

# Restart services
sudo -u taklite docker compose restart taklite-server
```

**4. Subdomain Not Working**
```bash
# Check if subdomain DNS is configured
nslookup api.your-domain.com

# Check Nginx configuration (Droplets)
sudo nginx -t
sudo systemctl reload nginx
```

### DNS Provider Specific Issues

**Cloudflare:**
- Ensure "Proxy" is disabled if you're having SSL issues
- Check if "Always Use HTTPS" is enabled
- Verify "SSL/TLS" mode is set to "Full" or "Full (strict)"

**GoDaddy:**
- DNS changes can take up to 24 hours to propagate
- Ensure you're editing the correct DNS zone
- Check if domain is locked

**Namecheap:**
- DNS changes usually propagate within 15 minutes
- Ensure you're using the correct nameservers
- Check if domain has privacy protection enabled

## 📚 Additional Resources

- [DigitalOcean DNS Documentation](https://docs.digitalocean.com/products/networking/dns/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [cert-manager Documentation](https://cert-manager.io/docs/)
- [DNS Propagation Checker](https://www.whatsmydns.net/)
- [SSL Labs SSL Test](https://www.ssllabs.com/ssltest/)
