#!/usr/bin/env bash
# Native test loop (docs/architecture.md, "Native apps"):
#   pnpm cap:ios:test [--launch]       E2E build → cap sync ios → Simulator build → install
#   pnpm cap:android:test [--launch]   E2E build → cap sync android → debug APK → install
# then tails the app's `[e2e]` markers.
#
# VITE_E2E (default `submit`) picks the scenario (src/e2e/index.ts); VITE_API_ORIGIN (default
# http://localhost:5173, a `pnpm dev` with DATABASE_URL in .env) is the API the build calls.
# Android gets `adb reverse` for a localhost API, so the emulator reaches the Mac's dev server.
# IOS_SIMULATOR (default `booted`) and ANDROID_SERIAL pick the device.
#
# Agents launch the app from the T3 Device panel (agent-device); `--launch` launches it here
# instead (simctl / adb), and on iOS also captures the app's stdout, where Capacitor prints the
# WebView console. Without it, read iOS markers from the on-screen status line.
set -euo pipefail

platform="${1:-}"
launch=false
[[ "${2:-}" == "--launch" ]] && launch=true
if [[ "$platform" != ios && "$platform" != android ]]; then
  echo "Usage: scripts/cap-test.sh ios|android [--launch]" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
export VITE_E2E="${VITE_E2E:-submit}"
export VITE_API_ORIGIN="${VITE_API_ORIGIN:-http://localhost:5173}"
VITE_API_ORIGIN="${VITE_API_ORIGIN%/}"
app_id=com.curiouslycory.dustbunny

echo "▸ E2E build (VITE_E2E=$VITE_E2E, API $VITE_API_ORIGIN)"
pnpm -s cap:build
npx cap sync "$platform"
pnpm -s cap:check "$platform"

if [[ "$platform" == ios ]]; then
  sim="${IOS_SIMULATOR:-booted}"
  echo "▸ xcodebuild (iOS Simulator)"
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO -quiet build
  xcrun simctl install "$sim" ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app
  echo "▸ Installed $app_id on the $sim Simulator"
  if $launch; then
    xcrun simctl terminate "$sim" "$app_id" 2>/dev/null || true
    echo "▸ Launching; [e2e] markers follow (Ctrl-C to stop)"
    xcrun simctl launch --console-pty --terminate-running-process "$sim" "$app_id" | grep --line-buffered '\[e2e\]'
  else
    echo "Launch it from the Device panel; its markers show in the status line at the bottom of the screen."
  fi
else
  echo "▸ gradlew assembleDebug"
  (cd android && ./gradlew -q assembleDebug)
  adb install -r android/app/build/outputs/apk/debug/app-debug.apk
  if [[ "$VITE_API_ORIGIN" =~ ^http://(localhost|127\.0\.0\.1)(:([0-9]+))?$ ]]; then
    port="${BASH_REMATCH[3]:-80}"
    adb reverse "tcp:$port" "tcp:$port" >/dev/null
    echo "▸ adb reverse tcp:$port → this machine"
  fi
  echo "▸ Installed $app_id"
  adb logcat -c
  if $launch; then adb shell am start -n "$app_id/.MainActivity" >/dev/null; else echo "Launch it from the Device panel."; fi
  echo "▸ [e2e] markers follow (Ctrl-C to stop)"
  adb logcat -v brief -s Capacitor/Console | grep --line-buffered '\[e2e\]'
fi
