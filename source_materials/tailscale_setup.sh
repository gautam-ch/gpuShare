#!/bin/bash
# Standard Tailscale install script from tailscale.com
curl -fsSL https://tailscale.com/install.sh | sh

# Authenticate and connect to the Tailnet
# (Requires user to click the auth link)
sudo tailscale up

# Get the Tailscale IP
TAILSCALE_IP=$(tailscale ip -4)
echo "Machine connected to Tailnet at: $TAILSCALE_IP"
