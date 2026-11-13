"""Read-only checks for the Studio interface-fix build inputs and outputs."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from verify_support import bytes_match, read_gradle_version, render_gate

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "studio" / "web"
PHOTO = ROOT / "photo"
ASSETS = ROOT / "studio" / "src" / "main" / "assets" / "studio"
EDITOR_ACTIVITY = ROOT / "studio" / "src" / "main" / "java" / "cn" / "wuziping" / "studio" / "EditorActivity.java"
INDEX = WEB / "src" / "index.html"
BUILD_SCRIPT = WEB / "build.mjs"
PHOTO_BUILD_SCRIPT = WEB / "build-photo.mjs"
WORKSPACE_BUNDLE = ASSETS / "app.js"
# npm run build is `node build.mjs && node build-photo.mjs`. The photo script
# resolves ../../photo from studio/web, so a temp tree must contain both.
STAGED_BUILD_FILES = ("build.mjs", "build-photo.mjs", "package.json", "package-lock.json")

results: list[tuple[str, str, str]] = []


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(name: str, action) -> None:
    try:
        status, detail = action()
    except Exception as error:
        status, detail = "FAIL", f"{type(error).__name__}: {error}"
    results.append((name, status, detail))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def check_index_link():
    text = INDEX.read_text(encoding="utf-8")
    marker = '<link rel="stylesheet" href="ai.css">'
    require(marker in text, "index.html is missing the ai.css stylesheet link")
    return "PASS", marker


def check_asset_hash():
    source = WEB / "src" / "ai.css"
    bundled = ASSETS / "ai.css"
    require(source.is_file(), f"missing source: {source.relative_to(ROOT)}")
    require(bundled.is_file(), f"missing bundled asset: {bundled.relative_to(ROOT)}")
    source_hash = sha256(source)
    bundled_hash = sha256(bundled)
    require(source_hash == bundled_hash, f"hash mismatch: source={source_hash} bundled={bundled_hash}")
    return "PASS", f"sha256={source_hash}"


def check_copy_manifest():
    text = BUILD_SCRIPT.read_text(encoding="utf-8")
    require("'ai.css'" in text, "build.mjs copyFile list does not contain 'ai.css'")
    return "PASS", "build.mjs copies ai.css"


def packaged_page_source() -> str:
    text = EDITOR_ACTIVITY.read_text(encoding="utf-8")
    start = text.find("private void loadPackagedPage()")
    require(start >= 0, "loadPackagedPage() not found")
    end = text.find("private void escalateTransport()", start)
    require(end > start, "loadPackagedPage() terminator not found")
    return text[start:end]


def check_ai_read():
    section = packaged_page_source()
    require('readText("studio/ai.css")' in section, 'loadPackagedPage() does not read studio/ai.css')
    return "PASS", 'readText("studio/ai.css")'


def check_ai_inline_replace():
    section = packaged_page_source()
    require('href=\\"ai.css\\"' in section, "ai.css link replacement is missing")
    require('"<style>"+aiCss+"</style>"' in section, "aiCss is not inserted as a style element")
    return "PASS", "ai.css link is replaced with inline aiCss"


def check_stylesheet(name: str, variable: str):
    def action():
        section = packaged_page_source()
        require(f'readText("studio/{name}")' in section, f"loadPackagedPage() does not read {name}")
        require(f'href=\\"{name}\\"' in section, f"{name} link replacement is missing")
        require(f'"<style>"+{variable}+"</style>"' in section, f"{name} is not inserted as a style element")
        return "PASS", f"{name} is in the inline fallback"
    return action


def link_node_modules(source: Path, target: Path) -> None:
    if os.name == "nt":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(target), str(source)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise OSError((result.stderr or result.stdout or "mklink /J failed").strip())
    else:
        target.symlink_to(source, target_is_directory=True)


def current_studio_apk() -> Path:
    version = read_gradle_version(ROOT / "studio" / "build.gradle")
    return ROOT / "dist" / f"Ember-Studio-{version.version_name}.apk"


def copy_web_sources(temp: Path) -> Path:
    """Copy the files `npm run build` needs. Does not link node_modules or photo/."""
    temp_web = temp / "studio" / "web"
    shutil.copytree(WEB / "src", temp_web / "src")
    for name in STAGED_BUILD_FILES:
        source = WEB / name
        if source.is_file():
            shutil.copy2(source, temp_web / name)
    if not (temp_web / "build-photo.mjs").is_file():
        raise FileNotFoundError("temporary tree is missing build-photo.mjs")
    (temp / "studio" / "src" / "main" / "assets" / "studio").mkdir(parents=True, exist_ok=True)
    return temp_web


def stage_web_tree(temp: Path) -> Path:
    """Copy sources and link node_modules plus the photo tree build-photo.mjs imports."""
    temp_web = copy_web_sources(temp)
    link_node_modules(WEB / "node_modules", temp_web / "node_modules")
    link_node_modules(PHOTO, temp / "photo")
    return temp_web


def check_bundle_sync():
    node = shutil.which("node")
    if not node:
        return "SKIP", "node executable is unavailable"
    if not (WEB / "node_modules").is_dir():
        return "SKIP", "studio/web/node_modules is unavailable"
    if not WORKSPACE_BUNDLE.is_file():
        return "FAIL", f"missing workspace bundle: {WORKSPACE_BUNDLE.relative_to(ROOT)}"
    if not PHOTO_BUILD_SCRIPT.is_file():
        return "FAIL", "studio/web/build-photo.mjs is missing"

    workspace_hash = sha256(WORKSPACE_BUNDLE)
    with tempfile.TemporaryDirectory(prefix="wuziping-interface-verify-") as temp_name:
        temp = Path(temp_name)
        temp_web = stage_web_tree(temp)
        temp_out = temp / "studio" / "src" / "main" / "assets" / "studio"

        npm = shutil.which("npm.cmd") or shutil.which("npm")
        command = [npm, "run", "build"] if npm else [node, "build.mjs"]
        completed = subprocess.run(
            command,
            cwd=temp_web,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if completed.returncode != 0:
            output = (completed.stderr or completed.stdout or "").strip().splitlines()
            tail = " | ".join(output[-16:]) if output else "no build output"
            raise RuntimeError(f"temporary build failed: {tail}")
        generated = temp_out / "app.js"
        require(generated.is_file(), "temporary build did not create app.js")
        generated_hash = sha256(generated)
        runner = "npm run build" if npm else "node build.mjs (npm script target)"
        require(
            generated_hash == workspace_hash,
            f"bundle mismatch: generated={generated_hash} workspace={workspace_hash}",
        )
        return "PASS", f"{runner}; sha256={workspace_hash}"


def check_apk_ai_css():
    apk = current_studio_apk()
    if not apk.is_file():
        return "FAIL", f"{apk.relative_to(ROOT)} is not in the checkout"
    source = (WEB / "src" / "ai.css").read_bytes()
    with zipfile.ZipFile(apk) as archive:
        try:
            packed = archive.read("assets/studio/ai.css")
        except KeyError:
            return "FAIL", "assets/studio/ai.css is missing from the APK"
    kind = bytes_match(packed, source)
    require(kind is not None, f"ai.css differs from source in {apk.name}")
    return "PASS", f"{apk.name} ai.css matches source ({kind})"


def check_apk_bundle():
    apk = current_studio_apk()
    if not apk.is_file():
        return "FAIL", f"{apk.relative_to(ROOT)} is not in the checkout"
    workspace = WORKSPACE_BUNDLE.read_bytes()
    with zipfile.ZipFile(apk) as archive:
        try:
            packed = archive.read("assets/studio/app.js")
        except KeyError:
            return "FAIL", "assets/studio/app.js is missing from the APK"
    kind = bytes_match(packed, workspace)
    require(kind is not None, f"app.js differs from the workspace bundle in {apk.name}")
    digest = hashlib.sha256(packed).hexdigest()
    return "PASS", f"{apk.name} app.js matches workspace ({kind}); sha256={digest}"


def print_table() -> None:
    name_width = max(5, *(len(name) for name, _, _ in results))
    print(f"{'CHECK'.ljust(name_width)}  {'STATUS':6}  DETAIL")
    print(f"{'-' * name_width}  {'-' * 6}  {'-' * 48}")
    for name, status, detail in results:
        print(f"{name.ljust(name_width)}  {status:6}  {detail}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="Release gate: a skipped bundle or APK check exits non-zero.")
    args = parser.parse_args(argv)
    record("index ai.css link", check_index_link)
    record("asset ai.css hash", check_asset_hash)
    record("build ai.css copy", check_copy_manifest)
    record("fallback ai.css read", check_ai_read)
    record("fallback ai.css inline", check_ai_inline_replace)
    record("fallback style.css", check_stylesheet("style.css", "css"))
    record("fallback lecture.css", check_stylesheet("lecture.css", "lectureCss"))
    record("fallback tts.css", check_stylesheet("tts.css", "ttsCss"))
    record("fallback ai.css inline list", check_stylesheet("ai.css", "aiCss"))
    record("generated bundle sync", check_bundle_sync)
    record("APK ai.css", check_apk_ai_css)
    record("APK app.js", check_apk_bundle)

    print_table()
    code, text = render_gate(results, args.strict)
    print(text, end="")
    return code


if __name__ == "__main__":
    sys.exit(main())
