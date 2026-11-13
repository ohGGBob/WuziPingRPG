#!/usr/bin/env bash
# Linux counterpart of build-apk.ps1. Debug-signs with build/manual/debug.keystore, alias androiddebugkey.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_ROOT="${SDK_ROOT:-${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}}"
JDK_ROOT="${JDK_ROOT:-${JAVA_HOME:-}}"
if [[ -z "$JDK_ROOT" ]]; then
  if command -v javac >/dev/null 2>&1; then JDK_ROOT="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  else echo "Set JDK_ROOT or JAVA_HOME" >&2; exit 1; fi
fi
if [[ -z "$SDK_ROOT" ]]; then echo "Set SDK_ROOT or ANDROID_HOME" >&2; exit 1; fi
if ! command -v python3 >/dev/null 2>&1; then echo "python3 is required to read app/build.gradle" >&2; exit 1; fi
eval "$(python3 "$ROOT/tools/verify_support.py" --gradle "$ROOT/app/build.gradle" --shell)"
PLATFORM="$SDK_ROOT/platforms/android-34/android.jar"
python3 "$ROOT/tools/package_preflight.py" --root "$ROOT"
BUILD_TOOLS="$(python3 "$ROOT/tools/verify_support.py" --sdk-root "$SDK_ROOT" --print-build-tools)"
for required in "$PLATFORM" "$JDK_ROOT/bin/javac" "$BUILD_TOOLS/aapt2"; do
  if [[ ! -e "$required" ]]; then echo "Missing build dependency: $required" >&2; exit 1; fi
done
WORK="$ROOT/build/manual"
CLASSES="$WORK/classes"
DEX="$WORK/dex"
DIST="$ROOT/dist"
mkdir -p "$CLASSES" "$DEX" "$DIST"
mapfile -d '' SOURCES < <(find "$ROOT/core/src/main/java" "$ROOT/app/src/main/java" -name '*.java' -print0)
"$JDK_ROOT/bin/javac" -encoding UTF-8 --release 8 -classpath "$PLATFORM" -d "$CLASSES" "${SOURCES[@]}"
"$JDK_ROOT/bin/jar" cf "$WORK/classes.jar" -C "$CLASSES" .
"$JDK_ROOT/bin/java" -cp "$BUILD_TOOLS/lib/d8.jar" com.android.tools.r8.D8 --lib "$PLATFORM" --min-api 23 --output "$DEX" "$WORK/classes.jar"
"$BUILD_TOOLS/aapt2" compile --dir "$ROOT/app/src/main/res" -o "$WORK/resources.zip"
MANIFEST="$WORK/AndroidManifest.xml"
APP_ID="cn.wuziping.ember"
SUFFIX="debug"
if [[ "${PARALLEL_INSTALL:-0}" == 1 ]]; then APP_ID="cn.wuziping.ember.preview07"; SUFFIX="parallel-debug"; fi
sed "s/<manifest /<manifest package=\"$APP_ID\" /" "$ROOT/app/src/main/AndroidManifest.xml" > "$MANIFEST"
if [[ "${PARALLEL_INSTALL:-0}" == 1 ]]; then sed -i 's/伍子平 · 星火远征"/伍子平 · 星火远征 0.7试玩"/' "$MANIFEST"; fi
UNSIGNED="$WORK/unsigned.apk"
"$BUILD_TOOLS/aapt2" link -o "$UNSIGNED" --manifest "$MANIFEST" -I "$PLATFORM" -A "$ROOT/app/src/main/assets" -0 wav \
  --min-sdk-version 23 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$WORK/resources.zip"
"$JDK_ROOT/bin/jar" uf "$UNSIGNED" -C "$DEX" classes.dex
ALIGNED="$WORK/aligned.apk"
"$BUILD_TOOLS/zipalign" -f 4 "$UNSIGNED" "$ALIGNED"
KEYSTORE="$WORK/debug.keystore"
if [[ ! -f "$KEYSTORE" ]]; then
  "$JDK_ROOT/bin/keytool" -genkeypair -keystore "$KEYSTORE" -storetype JKS -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=WuziPing Development, O=Student Project, C=CN"
fi
APK="$DIST/WuziPing-Emberbound-${VERSION_NAME}-$SUFFIX.apk"
"$JDK_ROOT/bin/java" -jar "$BUILD_TOOLS/lib/apksigner.jar" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android --out "$APK" "$ALIGNED"
"$JDK_ROOT/bin/java" -jar "$BUILD_TOOLS/lib/apksigner.jar" verify --verbose "$APK"
"$BUILD_TOOLS/zipalign" -c 4 "$APK"
"$BUILD_TOOLS/aapt" dump badging "$APK"
python3 "$ROOT/tools/verify_support.py" --merge-checksums "$DIST/SHA256SUMS.txt" \
  "WuziPing-Emberbound-${VERSION_NAME}-debug.apk" \
  "WuziPing-Emberbound-${VERSION_NAME}-parallel-debug.apk"
echo "APK ready: $APK"
