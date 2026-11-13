"""Verify the current Studio APK named by studio/build.gradle. Read-only.

It does not rewrite dist/STUDIO-SHA256SUMS.txt or emit a release JSON file.
0.2.7 / versionCode 39 is not the expected current package. Signature,
alignment and badging run only when the SDK tools exist. This does not build
or sign an APK.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

from verify_support import (
    ROOT,
    bytes_match,
    checksum_map,
    read_gradle_version,
    resolve_java,
    resolve_sdk_tool,
    sha256_file,
)


REQUIRED = (
    "assets/studio/index.html",
    "assets/studio/app.js",
    "assets/studio/style.css",
    "assets/studio/meteor-sky.webp",
    "assets/studio/sky-ripple.js",
    "assets/photo/index.html",
    "assets/studio/runtime/pyodide.js",
    "assets/audio/boss.wav",
    "assets/history_road.png",
    "assets/history_ford.png",
    "assets/history_soldier.png",
    "assets/history_bandit.png",
    "assets/history_commander.png",
)
DEX_CLASSES = (
    b"Lcom/scan/camera/MainActivity;",
    b"Lcn/wuziping/studio/PhotoActivity;",
    b"Lcn/wuziping/ember/Game;",
    b"Lcn/wuziping/ember/HistoryJourney;",
    b"Lcn/wuziping/studio/EditorActivity;",
)
MODES = (b"lecture", b"tts", b"scan", b"python", b"notepad", b"photo", b"ai", b"game")
RESULTS: list[tuple[str, str, str]] = []


def record(name: str, status: str, detail: str) -> None:
    RESULTS.append((name, status, detail))


def zip_entry(archive: zipfile.ZipFile, logical: str) -> bytes:
    forward = logical
    backward = logical.replace("/", "\\")
    names = set(archive.namelist())
    for candidate in (forward, backward):
        if candidate in names:
            return archive.read(candidate)
    raise KeyError(logical)


def check_workspace_pages(version_name: str) -> None:
    index = (ROOT / "studio/web/src/index.html").read_bytes()
    bundled = (ROOT / "studio/src/main/assets/studio/index.html").read_bytes()
    kind = bytes_match(index, bundled)
    if kind is None:
        raise AssertionError("studio/web/src/index.html and assets/studio/index.html differ")
    if f'class="brandver">{version_name}<'.encode() not in index:
        raise AssertionError(f"index.html brand is not {version_name}")
    copies = (
        ROOT / "studio/src/main/assets/studio/editor.page",
        ROOT / "studio/src/main/assets/editor.page",
    )
    for path in copies:
        if bytes_match(path.read_bytes(), index) is None:
            raise AssertionError(f"{path.relative_to(ROOT)} is not a copy of index.html")
    record("workspace pages", "PASS", f"index and editor.page copies agree on {version_name} ({kind})")


def check_checksum_file(path: Path, apk_name: str, digest: str) -> None:
    if not path.is_file():
        record(str(path.relative_to(ROOT)), "FAIL", "checksum file is missing")
        return
    entries = checksum_map(path)
    listed = entries.get(apk_name)
    if listed != digest:
        record(str(path.relative_to(ROOT)), "FAIL", f"{apk_name} listed={listed} computed={digest}")
        return
    bad = []
    for name, want in entries.items():
        target = ROOT / "dist" / name
        if not target.is_file():
            bad.append(f"{name} missing")
            continue
        got = sha256_file(target)
        if got != want:
            bad.append(f"{name} hash mismatch")
    if bad:
        record(str(path.relative_to(ROOT)), "FAIL", "; ".join(bad[:8]))
        return
    record(str(path.relative_to(ROOT)), "PASS", f"{len(entries)} entries match dist/, including {apk_name}")


def print_table() -> None:
    width = max(5, *(len(name) for name, _, _ in RESULTS))
    print(f"{'CHECK'.ljust(width)}  {'STATUS':6}  DETAIL")
    for name, status, detail in RESULTS:
        print(f"{name.ljust(width)}  {status:6}  {detail}")
    counts = {key: sum(status == key for _, status, _ in RESULTS) for key in ("PASS", "FAIL", "SKIP", "KNOWN")}
    print(
        f"\nSUMMARY: PASS={counts['PASS']} FAIL={counts['FAIL']} "
        f"SKIP={counts['SKIP']} KNOWN={counts['KNOWN']}"
    )


def main() -> int:
    try:
        version = read_gradle_version(ROOT / "studio" / "build.gradle")
        record("gradle version", "PASS", f"{version.version_name} versionCode {version.version_code}")
    except Exception as error:
        record("gradle version", "FAIL", str(error))
        print_table()
        return 1

    try:
        check_workspace_pages(version.version_name)
    except Exception as error:
        record("workspace pages", "FAIL", str(error))

    apk_name = f"Ember-Studio-{version.version_name}.apk"
    path = ROOT / "dist" / apk_name
    if not path.is_file():
        record(apk_name, "FAIL", "current gradle version has no dist APK")
        print_table()
        return 1
    digest = sha256_file(path)
    check_checksum_file(ROOT / "dist" / "STUDIO-SHA256SUMS.txt", apk_name, digest)
    check_checksum_file(ROOT / "STUDIO-SHA256SUMS.txt", apk_name, digest)
    parallel = ROOT / "dist" / f"Ember-Studio-{version.version_name}-parallel.apk"
    if parallel.is_file():
        record("parallel apk", "PASS", parallel.name)
    else:
        record("parallel apk", "KNOWN", f"{parallel.name} is not in dist; only the standard package is published")

    try:
        with zipfile.ZipFile(path) as archive:
            bad_zip = archive.testzip()
            if bad_zip is not None:
                raise AssertionError(f"corrupt zip entry {bad_zip}")
            for item in REQUIRED:
                zip_entry(archive, item)
            names = archive.namelist()
            if not any("gocrchinese" in name for name in names):
                raise AssertionError("gocr chinese data is missing")
            html = zip_entry(archive, "assets/studio/index.html")
            source_html = (ROOT / "studio/web/src/index.html").read_bytes()
            kind = bytes_match(html, source_html)
            if kind is None:
                raise AssertionError("APK index.html differs from studio/web/src/index.html")
            if version.version_name.encode() not in html or b"meteor-field" not in html or b"brandspark" in html:
                raise AssertionError("APK index.html failed the version/marker check")
            for mode in MODES:
                token = b'data-mode="' + mode + b'"'
                if token not in html:
                    raise AssertionError(f"missing {token.decode()}")
            fallback = zip_entry(archive, "assets/studio/editor.page")
            if bytes_match(fallback, html) is None:
                record(
                    "apk editor.page fallback",
                    "KNOWN",
                    "published assets/studio/editor.page is not the current index; PackedAssets tries index.html first. APK was not rebuilt",
                )
            else:
                record("apk editor.page fallback", "PASS", "fallback matches index.html")
            root_page = zip_entry(archive, "assets/editor.page")
            page_kind = bytes_match(root_page, html)
            if page_kind is None:
                raise AssertionError("assets/editor.page differs from index.html")
            dex = b"".join(
                archive.read(name) for name in names if name.startswith("classes") and name.endswith(".dex")
            )
            missing = [cls.decode() for cls in DEX_CLASSES if cls not in dex]
            if missing:
                raise AssertionError("dex missing " + ", ".join(missing))
        record("apk contents", "PASS", f"{apk_name} sha256={digest}; index.html {kind}")
    except Exception as error:
        record("apk contents", "FAIL", f"{type(error).__name__}: {error}")

    java = resolve_java()
    zipalign = resolve_sdk_tool(None, "zipalign")
    aapt = resolve_sdk_tool(None, "aapt")
    apksigner_dir = resolve_sdk_tool(None, "apksigner")
    signer_jar = apksigner_dir.parent / "lib" / "apksigner.jar" if apksigner_dir else None
    if java and signer_jar and signer_jar.is_file() and zipalign and aapt:
        import subprocess
        try:
            subprocess.run([str(zipalign), "-c", "4", str(path)], check=True)
            signature = subprocess.check_output(
                [str(java), "-jar", str(signer_jar), "verify", "--verbose", "--print-certs", str(path)],
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            if "Verified using v2 scheme (APK Signature Scheme v2): true" not in signature:
                raise AssertionError("v2 signature was not verified")
            meta = subprocess.check_output(
                [str(aapt), "dump", "badging", str(path)],
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            expected = (
                "package: name='cn.wuziping.ember' "
                f"versionCode='{version.version_code}' versionName='{version.version_name}'"
            )
            if expected not in meta:
                raise AssertionError(f"badging missing {expected}")
            record("sdk tools", "PASS", expected)
        except Exception as error:
            record("sdk tools", "FAIL", f"{type(error).__name__}: {error}")
    else:
        record("sdk tools", "SKIP", "java/zipalign/aapt/apksigner not all present; checksum and zip checks still ran")

    print_table()
    failed = any(status == "FAIL" for _, status, _ in RESULTS)
    print(f"EXIT: {'FAIL' if failed else 'PASS'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
