# 🐳 Using Docker with DigitalOcean App Platform

## Why Use Dockerfile Build Strategy?

DigitalOcean App Platform now supports **Dockerfile build strategy**, which means you can leverage your existing Docker containerization directly in App Platform. This is much better than using the Node.js buildpack!

## ✅ Benefits of Dockerfile Build Strategy

### **1. Consistency Across Environments**
- **Same container** runs locally, in staging, and in production
- **No surprises** - what works locally will work in production
- **Reproducible builds** every time

### **2. Leverages Your Existing Setup**
- **Uses your `Dockerfile`** with multi-stage builds
- **Respects your security practices** (non-root user, proper permissions)
- **Maintains your optimizations** (production dependencies only)

### **3. Better Performance**
- **Multi-stage builds** create smaller, faster images
- **Optimized layers** reduce build time
- **Cached dependencies** speed up deployments

### **4. Full Control**
- **Custom build process** exactly as you designed it
- **Environment variables** work the same way
- **Health checks** from your Dockerfile are respected

## 🔧 How It Works

### **App Platform Configuration**
```yaml
# .do/app.yaml
services:
  - name: api
    source_dir: /
    github:
      repo: medentem/tak-lite-server
      branch: main
    dockerfile_path: Dockerfile  # ← This is the key!
    instance_count: 1
    instance_size_slug: basic-xxs
    http_port: 3000
```

### **What App Platform Does**
1. **Clones your repository**
2. **Builds using your `Dockerfile`**
3. **Runs the container** with your exact configuration
4. **Manages scaling and updates** automatically

## 🚀 Migration from Node.js Buildpack

### **Before (Node.js Buildpack)**
```yaml
services:
  - name: api
    run_command: npm start
    environment_slug: node-js  # ← Generic Node.js environment
```

### **After (Dockerfile Build Strategy)**
```yaml
services:
  - name: api
    dockerfile_path: Dockerfile  # ← Your exact Docker setup
```

## 📋 Step-by-Step Setup

### **1. Update Your App Configuration**
- Use the provided `.do/app.yaml` file
- Ensure `dockerfile_path: Dockerfile` is set
- Remove `run_command` and `environment_slug`

### **2. Deploy via App Platform UI**
1. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
2. Click **"Create App"**
3. Connect your GitHub repository
4. **Select "Dockerfile" as build method** (not Node.js)
5. Configure your database and environment variables
6. Deploy!

### **3. Verify Your Deployment**
- Check that your app is running: `https://your-app.ondigitalocean.app/health`
- Verify it's using your Docker configuration
- Test all your endpoints

## 🔍 What Gets Deployed

### **From Your Dockerfile**
- ✅ Multi-stage build (builder + production)
- ✅ Non-root user (`nodejs:nodejs`)
- ✅ Production dependencies only
- ✅ Health check endpoint
- ✅ Proper file permissions
- ✅ Security optimizations

### **From Your docker-compose.yml**
- ✅ Environment variables structure
- ✅ Volume mounts (logs, uploads)
- ✅ Network configuration
- ✅ Service dependencies

## 🆚 Comparison: Buildpack vs Dockerfile

| Feature | Node.js Buildpack | Dockerfile Build Strategy |
|---------|------------------|---------------------------|
| **Build Control** | Limited | Full control |
| **Consistency** | Generic Node.js | Your exact setup |
| **Security** | Default settings | Your security practices |
| **Performance** | Standard | Optimized for your app |
| **Debugging** | Generic logs | Your specific logging |
| **Dependencies** | npm install | Your exact dependency management |

## 🛠️ Troubleshooting

### **Build Failures**
```bash
# Check your Dockerfile locally first
docker build -t tak-lite-server .
docker run -p 3000:3000 tak-lite-server
```

### **Environment Variables**
- Make sure all required environment variables are set in App Platform
- Use the same variable names as in your `docker-compose.yml`

### **Port Configuration**
- Your Dockerfile exposes port 3000
- App Platform should use `http_port: 3000`

### **Health Checks**
- Your Dockerfile includes a health check
- App Platform will use this automatically

## 🎯 Best Practices

### **1. Optimize Your Dockerfile**
```dockerfile
# Use multi-stage builds
FROM node:18-alpine AS builder
# ... build stage

FROM node:18-alpine AS production
# ... production stage with only necessary files
```

### **2. Use .dockerignore**
```dockerignore
node_modules
.git
*.log
.env
```

### **3. Environment Variables**
- Set all required variables in App Platform
- Use secrets for sensitive data
- Test locally with the same variables

### **4. Health Checks**
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:3000/health > /dev/null || exit 1
```

## 🚀 Next Steps

1. **Update your App Platform configuration** to use Dockerfile
2. **Test the deployment** with your existing setup
3. **Enjoy the benefits** of consistent, optimized deployments
4. **Scale confidently** knowing your container works the same everywhere

**The Dockerfile build strategy gives you the best of both worlds: the simplicity of App Platform with the power and control of your existing Docker setup!**
