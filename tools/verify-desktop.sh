#!/usr/bin/env bash
# Linux counterpart of verify-desktop.ps1. Same sources, tests, screenshots and preview jar.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JDK_ROOT="${JDK_ROOT:-${JAVA_HOME:-}}"
if [[ -z "$JDK_ROOT" ]]; then
  if command -v javac >/dev/null 2>&1; then JDK_ROOT="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  else echo "Set JDK_ROOT or JAVA_HOME" >&2; exit 1; fi
fi
CLASSES="$ROOT/build/desktop"
DIST="$ROOT/dist"
SCREENS="$ROOT/artifacts/screenshots-v0.7"
mkdir -p "$CLASSES" "$DIST" "$SCREENS"
mapfile -d '' SOURCES < <(find "$ROOT/core/src/main/java" "$ROOT/tools/desktop" "$ROOT/tools/tests" -name '*.java' -print0)
"$JDK_ROOT/bin/javac" -encoding UTF-8 --release 8 -d "$CLASSES" "${SOURCES[@]}"
(
  cd "$ROOT"
  while IFS= read -r name || [[ -n "${name:-}" ]]; do
    case "$name" in ''|\#*) continue ;; esac
    "$JDK_ROOT/bin/java" -cp "$CLASSES" "cn.wuziping.ember.tests.$name"
  done < "$ROOT/tools/java-suites-desktop.txt"
  "$JDK_ROOT/bin/java" -Djava.awt.headless=true -cp "$CLASSES" cn.wuziping.ember.desktop.Desktop --screenshots "$SCREENS"
  "$JDK_ROOT/bin/jar" cfe "$DIST/WuziPing-desktop-preview.jar" cn.wuziping.ember.desktop.Desktop -C "$CLASSES" . -C "$ROOT/app/src/main/assets" .
)
