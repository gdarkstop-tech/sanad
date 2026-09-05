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

for _ in $(seq 1 60); do
  ADDRESS="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  if [ -n "$ADDRESS" ] && curl -sf -o /dev/null --max-time 10 "$ADDRESS/sign-in"; then
    printf '\n\033[32mSanad is reachable from anywhere at:\033[0m\n\n'
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
  sleep 2
done

echo "The tunnel did not come up within two minutes. What cloudflared said:" >&2
tail -20 "$LOG" >&2
echo >&2
echo "If it mentions port 7844, the network here is blocking outbound traffic" >&2
echo "on that port, which is the one a tunnel needs. A phone hotspot usually" >&2
echo "gets around a restrictive network." >&2
exit 1
