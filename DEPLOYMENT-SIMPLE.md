# 🚀 TAK Lite Server - Simple Deployment Guide

## Choose Your Deployment Method

**🎯 For Most Users (Recommended)**: [App Platform](#app-platform) - Just connect your GitHub repo and deploy!

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

### Step 1: Create a Server
1. Go to [DigitalOcean Droplets](https://cloud.digitalocean.com/droplets)
2. Click **"Create Droplet"**
3. Choose **Ubuntu 22.04 LTS**
4. Select **Basic** plan, **$12/month** (2GB RAM, 1 vCPU)
5. Choose a region close to your users
6. Add your SSH key
7. Click **"Create Droplet"**

### Step 2: Set Up Your Domain (Optional)
1. Point your domain's A record to your droplet's IP address
2. Wait for DNS propagation (up to 48 hours)

### Step 3: Run the Setup Script
1. SSH into your droplet: `ssh root@your-droplet-ip`
2. Download and run the setup script:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/medentem/tak-lite-server/main/deploy/digitalocean-setup.sh | bash
   ```
3. Enter your domain name when prompted
4. Enter your email for SSL certificates
5. Wait for the script to complete (5-10 minutes)

### Step 4: Deploy Your App
1. Clone your repository:
   ```bash
   sudo -u taklite git clone https://github.com/medentem/tak-lite-server.git /home/taklite/tak-lite-server
   ```
2. Configure environment:
   ```bash
   sudo -u taklite cp /home/taklite/tak-lite-server/.env.template /home/taklite/tak-lite-server/.env
   sudo -u taklite nano /home/taklite/tak-lite-server/.env
   ```
3. Deploy:
   ```bash
   sudo -u taklite /home/taklite/tak-lite-server/deploy.sh
   ```

### Step 5: Complete Setup
1. Visit `https://your-domain.com/setup`
2. Fill out the setup form
3. Click **"Complete Setup"**

**🎉 Done!** Your server is now running with automatic SSL certificates and backups!

---

## 🏢 Kubernetes (Enterprise Users)

**Perfect for**: Large organizations needing high availability and auto-scaling

### Prerequisites
- Kubernetes knowledge
- Helm package manager
- DigitalOcean account

### Quick Setup
1. Create a Kubernetes cluster in DigitalOcean
2. Install Helm
3. Deploy using the provided Helm charts
4. Configure ingress and SSL certificates

**📖 For detailed Kubernetes setup, see the [Advanced Deployment Guide](deploy/README.md#kubernetes)**

---

## 💰 Cost Comparison

| Method | Monthly Cost | Setup Time | Technical Level |
|--------|-------------|------------|-----------------|
| **App Platform** | $20/month | 5 minutes | Beginner |
| **Droplet** | $12/month | 30 minutes | Intermediate |
| **Kubernetes** | $50+/month | 2+ hours | Advanced |

---

## 🆘 Need Help?

### Common Issues

**App Platform Issues:**
- Check your environment variables are set correctly
- Ensure your GitHub repository is public or connected properly
- Verify your database is running

**Droplet Issues:**
- Make sure your domain DNS is pointing to the correct IP
- Check if the setup script completed successfully
- Verify SSL certificates are working

**General Issues:**
- Check the [Troubleshooting Guide](deploy/README.md#troubleshooting)
- Visit the [GitHub Issues](https://github.com/medentem/tak-lite-server/issues)
- Join the [Discussions](https://github.com/medentem/tak-lite-server/discussions)

### Getting Support

- **Documentation**: [Full README](README.md)
- **Issues**: [GitHub Issues](https://github.com/medentem/tak-lite-server/issues)
- **Discussions**: [GitHub Discussions](https://github.com/medentem/tak-lite-server/discussions)
- **Email**: support@taklite.com

---

## 🎯 Next Steps

After deployment:

1. **Test your server**: Visit `/health` endpoint
2. **Set up your team**: Use the admin dashboard at `/admin`
3. **Configure your app**: Update your TAK Lite app to connect to your server
4. **Monitor usage**: Check the metrics at `/metrics`

**Happy deploying! 🚀**
