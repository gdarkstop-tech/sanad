#!/usr/bin/env bash
#
# Sets Sanad up on a fresh Linux VM, and can be re-run safely.
#
# Written for Oracle Cloud's Always Free instances, where two things catch
# everyone out:
#
#   · Inbound traffic is blocked at two layers. The cloud console's security
#     list is the one people find; the firewall on the instance itself is the
#     one they miss, and the symptom is identical — a server that works over SSH
#     and is unreachable from anywhere else.
#   · The free ARM instances are aarch64. Building the image here rather than
#     shipping one avoids the question entirely.
#
# Usage, on the VM:
#   export DATABASE_URL='postgres://…'
#   export APP_SECRET="$(openssl rand -base64 32)"
#   bash scripts/vm-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${SANAD_PORT:-3000}"
CONTAINER="${SANAD_CONTAINER:-sanad}"

: "${DATABASE_URL:?DATABASE_URL is not set. export it before running this.}"
: "${APP_SECRET:?APP_SECRET is not set. Try: export APP_SECRET=\"\$(openssl rand -base64 32)\"}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# --- Docker ---------------------------------------------------------------
if command -v docker > /dev/null 2>&1; then
  say "Docker is already installed"
else
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
  # So docker works without sudo next time. Takes effect on the next login,
  # which is why everything below still says sudo.
  sudo usermod -aG docker "$USER" || true
fi

DOCKER="sudo docker"
$DOCKER info > /dev/null 2>&1 || { echo "Docker is installed but not running." >&2; exit 1; }

# --- The firewall on the instance ----------------------------------------
# Opening the cloud security list is not enough; this is the half that gets
# forgotten. Both branches are idempotent.
say "Opening port $PORT on the instance firewall"
if command -v firewall-cmd > /dev/null 2>&1 && sudo firewall-cmd --state > /dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-port="$PORT/tcp"
  sudo firewall-cmd --reload
  echo "firewalld: $PORT/tcp open"
elif command -v iptables > /dev/null 2>&1; then
  if sudo iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; then
    echo "iptables: $PORT/tcp already open"
  else
    # Inserted at the top: Oracle's Ubuntu images end the INPUT chain with a
    # REJECT, so a rule appended after it would never be reached.
    sudo iptables -I INPUT 1 -p tcp --dport "$PORT" -j ACCEPT
    echo "iptables: $PORT/tcp open"
  fi
  if command -v netfilter-persistent > /dev/null 2>&1; then
    sudo netfilter-persistent save > /dev/null && echo "iptables: saved across reboots"
  else
    echo "NOTE: install iptables-persistent, or this rule is lost on reboot:" >&2
    echo "      sudo apt-get install -y iptables-persistent" >&2
  fi
else
  echo "No firewall tool found; assuming the port is already open." >&2
fi

# --- Build and run --------------------------------------------------------
say "Building the image (several minutes the first time)"
$DOCKER build -t sanad .

say "Starting the container"
$DOCKER rm -f "$CONTAINER" > /dev/null 2>&1 || true
$DOCKER run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "$PORT:7860" \
  -e DATABASE_URL="$DATABASE_URL" \
  -e APP_SECRET="$APP_SECRET" \
  sanad > /dev/null

say "Waiting for it to answer"
for _ in $(seq 1 90); do
  if curl -sf -o /dev/null "http://localhost:$PORT/sign-in"; then
    IP="$(curl -s --max-time 5 https://api.ipify.org || echo '<your VM public IP>')"
    printf '\n\033[32mSanad is up.\033[0m\n\n'
    echo "  On this machine:  http://localhost:$PORT"
    echo "  From your phone:  http://$IP:$PORT"
    echo
    echo "Enter that second address on the app's sign-in screen."
    echo
    echo "If the phone cannot reach it, the cloud security list still needs an"
    echo "ingress rule for TCP $PORT — that is the half this script cannot do."
    exit 0
  fi
  sleep 2
done

echo "It did not answer within three minutes. What it said:" >&2
$DOCKER logs --tail 40 "$CONTAINER" >&2
exit 1
