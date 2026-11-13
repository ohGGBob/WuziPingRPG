#!/usr/bin/env bash
# Linux counterpart of build-studio.ps1.
# Calls javac, d8, aapt2, zipalign and apksigner directly. Gradle is not used.
# Signs with build/manual/debug.keystore (alias androiddebugkey, passwords android).
# That file is gitignored. It must be the original development key or an
# already-installed copy will refuse the upgrade.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK_ROOT="${SDK_ROOT:-${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}}"
JDK_ROOT="${JDK_ROOT:-${JAVA_HOME:-}}"
SIGNING_KEY="${SIGNING_KEY:-}"
PARALLEL="${PARALLEL_INSTALL:-0}"
SKIP_WEB="${SKIP_WEB_BUILD:-0}"

# Single source of truth for the version: parse it from studio/build.gradle,
# matching tools/build-studio.ps1. versionName is single-quoted, versionCode is bare.
GRADLE_FILE="$ROOT/studio/build.gradle"
VERSION_CODE="$(sed -n 's/.*versionCode[[:space:]]\{1,\}\([0-9]\{1,\}\).*/\1/p' "$GRADLE_FILE" | head -n 1)"
VERSION_NAME="$(sed -n "s/.*versionName[[:space:]]*'\\([^']*\\)'.*/\\1/p" "$GRADLE_FILE" | head -n 1)"
if [[ -z "$VERSION_NAME" || -z "$VERSION_CODE" ]]; then
  echo "Cannot parse versionName/versionCode from studio/build.gradle" >&2
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --parallel) PARALLEL=1; shift ;;
    --skip-web-build) SKIP_WEB=1; shift ;;
    --signing-key) SIGNING_KEY="$2"; shift 2 ;;
    --sdk-root) SDK_ROOT="$2"; shift 2 ;;
    --jdk-root) JDK_ROOT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$JDK_ROOT" ]]; then
  if command -v javac >/dev/null 2>&1; then JDK_ROOT="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  else echo "Set JDK_ROOT or JAVA_HOME" >&2; exit 1; fi
fi
if [[ -z "$SDK_ROOT" ]]; then echo "Set SDK_ROOT, ANDROID_HOME or ANDROID_SDK_ROOT" >&2; exit 1; fi

PLATFORM="$SDK_ROOT/platforms/android-34/android.jar"
BT="$SDK_ROOT/build-tools/34.0.0"
for required in "$PLATFORM" "$JDK_ROOT/bin/javac" "$JDK_ROOT/bin/jar" "$JDK_ROOT/bin/java" "$BT/aapt2" "$BT/aapt" "$BT/zipalign" "$BT/lib/d8.jar" "$BT/lib/apksigner.jar"; do
  if [[ ! -e "$required" ]]; then echo "Missing build dependency: $required" >&2; exit 1; fi
done

WORK="$ROOT/build/studio"
CLASSES="$WORK/classes"
DEX="$WORK/dex"
DIST="$ROOT/dist"
mkdir -p "$CLASSES" "$DEX" "$DIST" "$WORK"

if [[ "$SKIP_WEB" != 1 ]]; then
  (cd "$ROOT/studio/web" && npm run build)
fi

for name in pyodide.js pyodide.asm.js pyodide.asm.wasm python_stdlib.zip pyodide-lock.json; do
  if [[ ! -f "$ROOT/studio/src/main/assets/studio/runtime/$name" ]]; then
    echo "Missing offline Python asset: $name. Run tools/fetch-python-runtime.ps1 first." >&2
    exit 1
  fi
done

cp -f "$ROOT/artifacts/screenshots-v0.7/08-town.png" "$ROOT/studio/src/main/assets/studio-game.png"

SOURCES=()
while IFS= read -r -d '' file; do SOURCES+=("$file"); done < <(find "$ROOT/core/src/main/java" "$ROOT/app/src/main/java" "$ROOT/studio/src/main/java" -name '*.java' -print0)
"$JDK_ROOT/bin/javac" -encoding UTF-8 --release 8 -classpath "$PLATFORM" -d "$CLASSES" "${SOURCES[@]}"
"$JDK_ROOT/bin/jar" cf "$WORK/classes.jar" -C "$CLASSES" .
"$JDK_ROOT/bin/java" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --lib "$PLATFORM" --min-api 23 --output "$DEX" "$WORK/classes.jar"

"$BT/aapt2" compile --dir "$ROOT/studio/src/main/res" -o "$WORK/resources.zip"

if [[ "$PARALLEL" == 1 ]]; then
  APP_ID="cn.wuziping.ember.preview07"
  APK_NAME="Ember-Studio-${VERSION_NAME}-parallel.apk"
else
  APP_ID="cn.wuziping.ember"
  APK_NAME="Ember-Studio-${VERSION_NAME}.apk"
fi

python3 - "$ROOT/studio/src/main/AndroidManifest.xml" "$WORK/AndroidManifest.xml" "$APP_ID" "$PARALLEL" <<'PY'
import pathlib, sys
src, dest, app_id, parallel = sys.argv[1:]
text = pathlib.Path(src).read_text(encoding="utf-8")
text = text.replace("<manifest ", '<manifest package="%s" ' % app_id, 1)
text = text.replace('${studioLabel}', '天工 · 试玩' if parallel == "1" else '天工')
pathlib.Path(dest).write_text(text, encoding="utf-8", newline="\n")
PY

PAGE="$ROOT/studio/src/main/assets/studio/index.html"
cp -f "$PAGE" "$ROOT/studio/src/main/assets/studio/editor.page"
cp -f "$PAGE" "$ROOT/studio/src/main/assets/editor.page"

UNSIGNED="$WORK/unsigned.apk"
"$BT/aapt2" link -o "$UNSIGNED" --manifest "$WORK/AndroidManifest.xml" -I "$PLATFORM" \
  -A "$ROOT/app/src/main/assets" -A "$ROOT/studio/src/main/assets" \
  -0 wav -0 wasm -0 zip -0 js -0 mjs -0 html -0 css -0 page \
  --min-sdk-version 23 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "$WORK/resources.zip"
"$JDK_ROOT/bin/jar" uf "$UNSIGNED" -C "$DEX" classes.dex
python3 "$ROOT/tools/normalize-apk-assets.py" "$UNSIGNED"

ALIGNED="$WORK/aligned.apk"
"$BT/zipalign" -f 4 "$UNSIGNED" "$ALIGNED"

if [[ -n "$SIGNING_KEY" ]]; then
  KEY="$(readlink -f "$SIGNING_KEY")"
else
  KEY="$ROOT/build/manual/debug.keystore"
fi
if [[ ! -f "$KEY" ]]; then
  echo "Original development key is missing. Reuse your original signing key for an in-place upgrade." >&2
  exit 1
fi

APK="$DIST/$APK_NAME"
"$JDK_ROOT/bin/java" -jar "$BT/lib/apksigner.jar" sign --ks "$KEY" --ks-pass pass:android --key-pass pass:android --out "$APK" "$ALIGNED"
rm -f "$APK.idsig"
"$JDK_ROOT/bin/java" -jar "$BT/lib/apksigner.jar" verify --verbose --print-certs "$APK"
"$BT/zipalign" -c 4 "$APK"
"$BT/aapt" dump badging "$APK"

python3 "$ROOT/tools/verify_support.py" --merge-checksums "$DIST/STUDIO-SHA256SUMS.txt" \
  "Ember-Studio-${VERSION_NAME}.apk" \
  "Ember-Studio-${VERSION_NAME}-parallel.apk"

echo "Studio APK ready: $APK"
