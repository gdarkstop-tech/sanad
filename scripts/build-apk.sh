#!/usr/bin/env bash
#
# Builds an installable Android APK.
#
# Expo Go is the normal way to run the mobile app, and needs none of this. This
# exists for the case Expo Go cannot serve: handing someone a phone with Sanad
# already on it, or an Expo Go release that no longer supports this SDK.
#
# The output is a release build — the JavaScript is bundled into the APK, so it
# runs with no Metro and no laptop involved. It still talks to a Sanad server,
# and the address is set on the sign-in screen rather than baked in here: LAN
# addresses change, and rebuilding an APK to follow a DHCP lease is no way to
# live.
#
# Requires the Android SDK and a JDK. Without them, build in Expo's cloud:
#   npx eas-cli build --platform android --profile preview
#
# One failure worth naming: if JAVA_TOOL_OPTIONS is set (some corporate proxies
# and container images set it), the JVM prints a notice to stderr on every
# launch. Gradle reads that notice as output from the prefab tool and fails with
# "[CXX1210] ... No compatible library found", which says nothing about the real
# cause. Build with it unset if you see that.
set -euo pipefail
cd "$(dirname "$0")/.."

MOBILE="apps/mobile"
OUT="${1:-$PWD/sanad.apk}"

if [ -z "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]; then
  echo "ANDROID_HOME is not set — install the Android SDK, or build in Expo's cloud:" >&2
  echo "  npx eas-cli build --platform android --profile preview" >&2
  exit 1
fi
SDK="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"

echo "==> Generating the native project from app.json"
# The android/ directory is generated, never edited: app.json is the only source
# of truth for the package name, permissions and icons. --clean makes that true
# rather than aspirational.
(cd "$MOBILE" && npx expo prebuild --platform android --clean --no-install)

echo "sdk.dir=$SDK" > "$MOBILE/android/local.properties"

echo "==> Building the release APK (first run downloads Gradle and dependencies)"
(cd "$MOBILE/android" && chmod +x gradlew && ./gradlew assembleRelease --no-daemon)

BUILT="$MOBILE/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$BUILT" ] || { echo "Build reported success but produced no APK at $BUILT" >&2; exit 1; }
cp "$BUILT" "$OUT"

echo
echo "==> $OUT  ($(du -h "$OUT" | cut -f1))"
echo
echo "Install it by copying it to the phone and opening it; Android will ask to"
echo "allow installs from that source. Then start the server with 'pnpm dev' and"
echo "enter the computer's address on the app's sign-in screen."
echo
echo "Signed with the local debug key, which differs per machine: uninstall an"
echo "APK built elsewhere before installing this one."
