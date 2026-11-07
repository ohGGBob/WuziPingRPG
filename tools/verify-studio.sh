#!/usr/bin/env bash
# Linux counterpart of verify-studio.ps1. Node TTS tests, then the Java suites.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JDK_ROOT="${JDK_ROOT:-${JAVA_HOME:-}}"
if [[ -z "$JDK_ROOT" ]]; then
  if command -v javac >/dev/null 2>&1; then JDK_ROOT="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  else echo "Set JDK_ROOT or JAVA_HOME" >&2; exit 1; fi
fi
if ! command -v node >/dev/null 2>&1; then echo "Node.js is required for the Studio web tests" >&2; exit 1; fi
node --test "$ROOT"/studio/web/tests/*.test.mjs
CLASSES="$ROOT/build/studio-tests"
mkdir -p "$CLASSES"
SOURCES=()
while IFS= read -r -d '' file; do SOURCES+=("$file"); done < <(find "$ROOT/core/src/main/java" "$ROOT/tools/tests" "$ROOT/studio/tests" -name '*.java' -print0)
SOURCES+=("$ROOT/studio/src/main/java/cn/wuziping/studio/TextFiles.java" "$ROOT/studio/src/main/java/cn/wuziping/studio/AssetServer.java" "$ROOT/studio/src/main/java/cn/wuziping/studio/PhoneActionPlan.java")
"$JDK_ROOT/bin/javac" -encoding UTF-8 --release 8 -d "$CLASSES" "${SOURCES[@]}"
for name in GameTests StoryTests BodyTests GuestTests ExpansionTests MathTests PhysicsTests; do
  "$JDK_ROOT/bin/java" -cp "$CLASSES" "cn.wuziping.ember.tests.$name"
done
"$JDK_ROOT/bin/java" -cp "$CLASSES" cn.wuziping.studio.tests.StudioFilesTests
