#!/bin/bash

###############################################################################
# URL Content Fetcher - GCP Deployment Script
# This script sets up the application on a GCP Compute Engine instance
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
GITHUB_REPO="${GITHUB_REPO:-https://github.com/yourusername/url-content-fetcher.git}"
INSTALL_DIR="/opt/url-content-fetcher"
DOCKER_COMPOSE_VERSION="v2.24.0"

echo -e "${GREEN}==================================================${NC}"
echo -e "${GREEN}URL Content Fetcher - GCP Deployment${NC}"
echo -e "${GREEN}==================================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Please run as root or with sudo${NC}"
  exit 1
fi

# Update system
echo -e "\n${YELLOW}[1/7] Updating system packages...${NC}"
apt-get update -qq
apt-get upgrade -y -qq

# Install Docker
echo -e "\n${YELLOW}[2/7] Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
  # Install prerequisites
  apt-get install -y -qq \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

  # Add Docker's official GPG key
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

  # Set up Docker repository
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

  # Install Docker Engine
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # Start and enable Docker
  systemctl start docker
  systemctl enable docker

  echo -e "${GREEN}✓ Docker installed successfully${NC}"
else
  echo -e "${GREEN}✓ Docker already installed${NC}"
fi

# Install Docker Compose (standalone)
echo -e "\n${YELLOW}[3/7] Installing Docker Compose...${NC}"
if ! command -v docker-compose &> /dev/null; then
  curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
    -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
  echo -e "${GREEN}✓ Docker Compose installed successfully${NC}"
else
  echo -e "${GREEN}✓ Docker Compose already installed${NC}"
fi

# Install Git
echo -e "\n${YELLOW}[4/7] Installing Git...${NC}"
if ! command -v git &> /dev/null; then
  apt-get install -y -qq git
  echo -e "${GREEN}✓ Git installed successfully${NC}"
else
  echo -e "${GREEN}✓ Git already installed${NC}"
fi

# Clone or update repository
echo -e "\n${YELLOW}[5/7] Setting up application...${NC}"
if [ -d "$INSTALL_DIR" ]; then
  echo "Directory exists, pulling latest changes..."
  cd "$INSTALL_DIR"
  git pull
else
  echo "Cloning repository..."
  git clone "$GITHUB_REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Set up environment file
echo -e "\n${YELLOW}[6/7] Configuring environment...${NC}"
if [ ! -f ".env.production" ]; then
  echo -e "${RED}Error: .env.production file not found${NC}"
  echo "Please create .env.production with your configuration"
  exit 1
fi

# Generate secure MongoDB password if using default
if grep -q "changeme123" .env.production; then
  echo -e "${YELLOW}Generating secure MongoDB password...${NC}"
  NEW_PASSWORD=$(openssl rand -base64 32)
  sed -i "s/changeme123/$NEW_PASSWORD/g" .env.production
  echo -e "${GREEN}✓ Secure password generated${NC}"
fi

# Build and start services
echo -e "\n${YELLOW}[7/7] Starting services...${NC}"
docker-compose --env-file .env.production down 2>/dev/null || true
docker-compose --env-file .env.production build --no-cache
docker-compose --env-file .env.production up -d

# Wait for services to be healthy
echo -e "\n${YELLOW}Waiting for services to be healthy...${NC}"
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
  echo -e "\n${GREEN}==================================================${NC}"
  echo -e "${GREEN}✓ Deployment completed successfully!${NC}"
  echo -e "${GREEN}==================================================${NC}"
  
  # Get external IP
  EXTERNAL_IP=$(curl -s ifconfig.me)
  
  echo -e "\n${GREEN}Application is now running at:${NC}"
  echo -e "  http://${EXTERNAL_IP}:8080"
  echo -e "\n${GREEN}API Endpoints:${NC}"
  echo -e "  POST http://${EXTERNAL_IP}:8080/urls"
  echo -e "  GET  http://${EXTERNAL_IP}:8080/urls"
  
  echo -e "\n${YELLOW}Useful Commands:${NC}"
  echo -e "  View logs:        docker-compose -f $INSTALL_DIR/docker-compose.yml logs -f"
  echo -e "  Restart:          docker-compose -f $INSTALL_DIR/docker-compose.yml restart"
  echo -e "  Stop:             docker-compose -f $INSTALL_DIR/docker-compose.yml stop"
  echo -e "  Start:            docker-compose -f $INSTALL_DIR/docker-compose.yml start"
  echo -e "  View status:      docker-compose -f $INSTALL_DIR/docker-compose.yml ps"
  
  echo -e "\n${YELLOW}MongoDB Access:${NC}"
  echo -e "  Connection String: Check .env.production in $INSTALL_DIR"
  
else
  echo -e "\n${RED}Deployment failed. Check logs with:${NC}"
  echo -e "  docker-compose -f $INSTALL_DIR/docker-compose.yml logs"
  exit 1
fi

# Set up log rotation
echo -e "\n${YELLOW}Setting up log rotation...${NC}"
cat > /etc/logrotate.d/url-content-fetcher <<EOF
/var/lib/docker/containers/*/*.log {
    rotate 7
    daily
    compress
    missingok
    delaycompress
    copytruncate
}
EOF

# Create systemd service for auto-restart on reboot
echo -e "\n${YELLOW}Creating systemd service...${NC}"
cat > /etc/systemd/system/url-content-fetcher.service <<EOF
[Unit]
Description=URL Content Fetcher
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker-compose --env-file .env.production up -d
ExecStop=/usr/bin/docker-compose --env-file .env.production down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable url-content-fetcher.service
echo -e "${GREEN}✓ Systemd service created and enabled${NC}"

echo -e "\n${GREEN}==================================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}==================================================${NC}"

