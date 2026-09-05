#!/usr/bin/env bash
#
# Gives the Sanad server running on this machine a public https:// address.
#
# The mobile app otherwise has to be on the same Wi-Fi as this computer. A
# tunnel removes that: the phone works on mobile data, on a venue's network, or
# anywhere else, and the connection is real HTTPS rather than plain HTTP over a
# local address.
#
# Free, no account, no card. The computer does have to stay on — the tunnel
# forwards to the server here, it does not replace it.
#
#   Terminal 1:  pnpm dev
#   Terminal 2:  pnpm tunnel
#
# Closing this window closes the tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${SANAD_PORT:-3000}"
BIN_DIR=".cloudflared"
mkdir -p "$BIN_DIR"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ASSET="cloudflared-windows-amd64.exe"; BIN="$BIN_DIR/cloudflared.exe" ;;
  Darwin)               ASSET="cloudflared-darwin-amd64.tgz";  BIN="$BIN_DIR/cloudflared" ;;
  *)                    ASSET="cloudflared-linux-amd64";       BIN="$BIN_DIR/cloudflared" ;;
esac

if [ ! -x "$BIN" ]; then
  echo "==> Downloading cloudflared (once)"
  URL="https://github.com/cloudflare/cloudflared/releases/latest/download/$ASSET"
  if [ "${ASSET##*.}" = "tgz" ]; then
    curl -fsSL "$URL" | tar -xz -C "$BIN_DIR" cloudflared
  else
    curl -fsSL -o "$BIN" "$URL"
  fi
  chmod +x "$BIN"
fi

# Start the tunnel only once the server answers. Pointed at a port with nothing
# on it, Cloudflare serves a 530 for the life of the tunnel and no amount of
# starting the server afterwards fixes it — the address just looks broken.
if ! curl -sf -o /dev/null "http://localhost:$PORT/sign-in"; then
  cat >&2 <<MISSING

Nothing is answering on port $PORT, so there is nothing to publish.

Start the server in another terminal first:

  pnpm dev

then run this again.

MISSING
  exit 1
fi

echo "==> Opening a tunnel to http://localhost:$PORT"
LOG="$(mktemp)"
"$BIN" tunnel --url "http://localhost:$PORT" --no-autoupdate > "$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true; rm -f "$LOG"' EXIT

# Two stages, reported separately. Cloudflare issues an address quickly and then
# takes a moment to route to it, and a single silent wait for both makes a
# working tunnel look like a hung one.
printf '    waiting for an address'
DEADLINE=$(( $(date +%s) + 60 ))
ADDRESS=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  ADDRESS="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$ADDRESS" ] && break
  printf '.'
  sleep 2
done
echo

if [ -z "$ADDRESS" ]; then
  echo "Cloudflare never issued an address. What cloudflared said:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

printf '    got %s\n' "$ADDRESS"
printf '    checking it answers'
DEADLINE=$(( $(date +%s) + 90 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if curl -sf -o /dev/null --max-time 8 "$ADDRESS/sign-in"; then
    printf '\n\n\033[32mSanad is reachable from anywhere at:\033[0m\n\n'
    printf '    \033[1m%s\033[0m\n\n' "$ADDRESS"
    echo "Enter that on the app's sign-in screen, under Change."
    echo
    echo "This address lasts as long as this window stays open. Close it and the"
    echo "address is gone; the next run gets a different one."
    echo
    echo "Leave this running. Ctrl-C to stop."
    wait "$TUNNEL_PID"
    exit 0
  fi
  printf '.'
  sleep 3
done

echo
echo "The address was issued but never started answering. What cloudflared said:" >&2
tail -20 "$LOG" >&2
echo >&2
echo "If it mentions port 7844, this network blocks the port a tunnel needs." >&2
echo "A phone hotspot usually gets around that." >&2
exit 1
