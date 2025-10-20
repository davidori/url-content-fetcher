# Deployment Guide - GCP Compute Engine

Complete guide to deploy URL Content Fetcher on Google Cloud Platform.

## 🚀 Quick Deploy (5 minutes)

### Prerequisites

- GCP Compute Engine instance running Debian/Ubuntu
- SSH access to the instance
- Ports 8080 configured in firewall rules
- At least 2GB RAM, 10GB disk

### 1. Connect to Your GCP Instance

```bash
gcloud compute ssh your-instance-name --zone=your-zone
```

Or use SSH:
```bash
ssh your-username@YOUR_INSTANCE_IP
```

### 2. Run the Deployment Script

```bash
# Switch to root
sudo su -

# Download the deployment script
curl -o deploy.sh https://raw.githubusercontent.com/davidori/url-content-fetcher/main/deploy.sh

# Make it executable
chmod +x deploy.sh

# Set your GitHub repository
export GITHUB_REPO="https://github.com/davidori/url-content-fetcher.git"

# Run the deployment
./deploy.sh
```

The script will:
- ✅ Install Docker & Docker Compose
- ✅ Clone your repository
- ✅ Set up MongoDB with secure password
- ✅ Build and start the application
- ✅ Configure auto-restart on reboot
- ✅ Set up log rotation

### 3. Test Your Deployment

```bash
# Get your external IP
EXTERNAL_IP=$(curl -s ifconfig.me)

# Test the API
curl http://$EXTERNAL_IP:8080/urls

# Store a URL
curl -X POST http://$EXTERNAL_IP:8080/urls \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com"]}'
```

---

## 📋 Manual Deployment Steps

If you prefer manual deployment:

### 1. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 2. Clone Repository

```bash
sudo mkdir -p /opt/url-content-fetcher
cd /opt/url-content-fetcher
sudo git clone https://github.com/davidori/url-content-fetcher.git .
```

### 3. Configure Environment

```bash
# Edit production environment file
sudo nano .env.production

# Set secure MongoDB password
MONGO_USERNAME=admin
MONGO_PASSWORD=your-secure-password-here

# Adjust other settings as needed
CONTENT_SIZE_LIMIT=5242880
MAX_REDIRECTS=5
CONTENT_REFETCH_INTERVAL_HOURS=12
REFETCH_CHECK_INTERVAL_MINUTES=30
```

### 4. Start Services

```bash
# Build and start
sudo docker-compose --env-file .env.production up -d --build

# Check status
sudo docker-compose ps

# View logs
sudo docker-compose logs -f
```

---

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_USERNAME` | MongoDB username | admin |
| `MONGO_PASSWORD` | MongoDB password | changeme123 |
| `CONTENT_SIZE_LIMIT` | Max content size (bytes) | 5242880 (5MB) |
| `MAX_REDIRECTS` | Max redirects to follow | 5 |
| `CONTENT_REFETCH_INTERVAL_HOURS` | Hours before refetch | 12 |
| `REFETCH_CHECK_INTERVAL_MINUTES` | Refetch check interval | 30 |

### Port Configuration

The application listens on:
- **Container**: Port 3000
- **Host**: Port 8080 (mapped in docker-compose.yml)

To change the external port, edit `docker-compose.yml`:
```yaml
ports:
  - "80:3000"  # Map to port 80 instead
```

---

## 🔒 GCP Firewall Configuration

### Allow HTTP Traffic (Port 8080)

Using gcloud CLI:
```bash
gcloud compute firewall-rules create allow-url-fetcher \
  --allow tcp:8080 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow URL Content Fetcher access"
```

Or via Console:
1. Go to VPC Network → Firewall
2. Create Firewall Rule
3. Name: `allow-url-fetcher`
4. Targets: All instances in network
5. Source IP ranges: `0.0.0.0/0`
6. Protocols and ports: TCP 8080
7. Create

---

## 📊 Monitoring & Management

### View Logs

```bash
# All services
sudo docker-compose -f /opt/url-content-fetcher/docker-compose.yml logs -f

# Application only
sudo docker logs -f url-fetcher-app

# MongoDB only
sudo docker logs -f url-fetcher-mongodb
```

### Check Service Status

```bash
sudo docker-compose -f /opt/url-content-fetcher/docker-compose.yml ps
```

### Restart Services

```bash
# Restart all
sudo docker-compose -f /opt/url-content-fetcher/docker-compose.yml restart

# Restart app only
sudo docker restart url-fetcher-app
```

### Stop Services

```bash
sudo docker-compose -f /opt/url-content-fetcher/docker-compose.yml stop
```

### Update Application

```bash
cd /opt/url-content-fetcher
sudo git pull
sudo docker-compose --env-file .env.production up -d --build
```

---

## 🗄️ Database Management

### Access MongoDB Shell

```bash
sudo docker exec -it url-fetcher-mongodb mongosh \
  -u admin \
  -p your-password \
  --authenticationDatabase admin
```

### Backup Database

```bash
sudo docker exec url-fetcher-mongodb mongodump \
  --username admin \
  --password your-password \
  --authenticationDatabase admin \
  --db url-content-fetcher \
  --out /tmp/backup

# Copy backup from container
sudo docker cp url-fetcher-mongodb:/tmp/backup ./backup-$(date +%Y%m%d)
```

### Restore Database

```bash
# Copy backup to container
sudo docker cp ./backup url-fetcher-mongodb:/tmp/backup

# Restore
sudo docker exec url-fetcher-mongodb mongorestore \
  --username admin \
  --password your-password \
  --authenticationDatabase admin \
  --db url-content-fetcher \
  /tmp/backup/url-content-fetcher
```

---

## 🔄 Auto-Restart on Reboot

The deployment script creates a systemd service that automatically starts containers on reboot.

Check service status:
```bash
sudo systemctl status url-content-fetcher
```

Manually start/stop:
```bash
sudo systemctl start url-content-fetcher
sudo systemctl stop url-content-fetcher
```

---

## 🐛 Troubleshooting

### Services Won't Start

```bash
# Check Docker status
sudo systemctl status docker

# Check logs
sudo docker-compose -f /opt/url-content-fetcher/docker-compose.yml logs

# Restart everything
sudo docker-compose -f /opt/url-content-fetcher/docker-compose.yml down
sudo docker-compose -f /opt/url-content-fetcher/docker-compose.yml up -d
```

### MongoDB Connection Issues

```bash
# Check MongoDB is running
sudo docker ps | grep mongodb

# Test MongoDB connection
sudo docker exec url-fetcher-mongodb mongosh --eval "db.runCommand('ping')"
```

### Application Can't Connect to MongoDB

```bash
# Check network
sudo docker network ls
sudo docker network inspect url-content-fetcher_app-network

# Verify environment variables
sudo docker exec url-fetcher-app env | grep MONGODB
```

### Port Already in Use

```bash
# Find what's using the port
sudo lsof -i :8080

# Kill the process or change the port in docker-compose.yml
```

---

## 📈 Performance Tuning

### For Production Workloads

Edit `docker-compose.yml`:

```yaml
services:
  mongodb:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G

  app:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

---

## 🔐 Security Recommendations

1. **Change default MongoDB password** in `.env.production`
2. **Use HTTPS** with a reverse proxy (Nginx/Caddy)
3. **Restrict firewall** to specific IP ranges if possible
4. **Enable GCP logging** for audit trails
5. **Regular backups** of MongoDB data
6. **Update regularly**: `git pull && docker-compose up -d --build`

---

## 📞 Support

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Verify environment: `docker-compose config`
3. Test connectivity: `curl http://localhost:8080/urls`
4. Check GitHub issues

---

## 🎉 Success!

Your URL Content Fetcher is now deployed and running on GCP!

**Access your API at:** `http://YOUR_INSTANCE_IP:8080`

