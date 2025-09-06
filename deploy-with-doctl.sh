#!/bin/bash

# TAK Lite Server - DigitalOcean App Platform Deployment with doctl
# This script uses the existing app.yaml configuration

set -e

echo "🚀 TAK Lite Server - DigitalOcean App Platform Deployment"
echo "========================================================"

# Check if doctl is installed
if ! command -v doctl &> /dev/null; then
    echo "❌ doctl is not installed. Please install it first:"
    echo "   https://docs.digitalocean.com/reference/doctl/how-to/install/"
    exit 1
fi

# Check if user is authenticated
if ! doctl account get &> /dev/null; then
    echo "❌ Please authenticate with doctl first:"
    echo "   doctl auth init"
    exit 1
fi

# Check if app.yaml exists
if [ ! -f ".do/app.yaml" ]; then
    echo "❌ app.yaml not found in .do/ directory"
    exit 1
fi

echo "✅ doctl is installed and authenticated"
echo "✅ app.yaml found"

# Deploy the app
echo ""
echo "🚀 Deploying TAK Lite Server to DigitalOcean App Platform..."
echo "This will create:"
echo "  - 1 Web Service (tak-lite-server)"
echo "  - 1 PostgreSQL Database"
echo "  - 1 Pre-deploy Job (database migrations)"
echo "  - Health checks and monitoring"
echo ""

read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 1
fi

# Create the app
echo "Creating app from app.yaml..."
APP_ID=$(doctl apps create --spec .do/app.yaml --format ID --no-header)

if [ -z "$APP_ID" ]; then
    echo "❌ Failed to create app"
    exit 1
fi

echo "✅ App created with ID: $APP_ID"

# Wait for deployment to complete
echo ""
echo "⏳ Waiting for deployment to complete..."
echo "This may take 5-10 minutes..."

# Get the app URL
APP_URL=$(doctl apps get $APP_ID --format "Spec.Services[0].Routes[0].Path" --no-header)

# Poll for deployment status
while true; do
    STATUS=$(doctl apps get $APP_ID --format "ActiveDeployment.Phase" --no-header)
    echo "Deployment status: $STATUS"
    
    if [ "$STATUS" = "ACTIVE" ]; then
        echo "✅ Deployment completed successfully!"
        break
    elif [ "$STATUS" = "ERROR" ] || [ "$STATUS" = "CANCELED" ]; then
        echo "❌ Deployment failed with status: $STATUS"
        echo "Check the DigitalOcean console for details:"
        echo "https://cloud.digitalocean.com/apps/$APP_ID"
        exit 1
    fi
    
    sleep 30
done

# Get the final app URL
FINAL_URL=$(doctl apps get $APP_ID --format "LiveURL" --no-header)

echo ""
echo "🎉 TAK Lite Server deployed successfully!"
echo "=========================================="
echo "App URL: $FINAL_URL"
echo "Setup URL: $FINAL_URL/setup"
echo "Health Check: $FINAL_URL/health"
echo ""
echo "Next steps:"
echo "1. Visit $FINAL_URL/setup to complete the initial setup"
echo "2. Create your admin account"
echo "3. Configure your organization"
echo ""
echo "To view logs:"
echo "doctl apps logs $APP_ID --type run"
echo ""
echo "To update the app:"
echo "doctl apps create-deployment $APP_ID"
