"""Verify the current game APKs. Read-only: it does not rewrite checksums or release notes.

The version comes from app/build.gradle. The historical 0.7.0 log
(artifacts/verification-v0.7.log, 354 checks) is not a pass condition.
Live Java suites are tools/verify-desktop.sh. Signature, alignment and badging
run only when the Android SDK tools are actually present. This does not build
or sign an APK.
"""
from __future__ import annotations

import argparse
import subprocess
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


GAME_CLASSES = (
    "Game",
    "MathJourney",
    "MathRenderer",
    "MainActivity",
    "GameView",
    "PhysicsJourney",
)
RESULTS: list[tuple[str, str, str]] = []


def record(name: str, status: str, detail: str) -> None:
    RESULTS.append((name, status, detail))


def apk_names(version_name: str) -> list[tuple[str, str]]:
    return [
        (f"WuziPing-Emberbound-{version_name}-debug.apk", "cn.wuziping.ember"),
        (f"WuziPing-Emberbound-{version_name}-parallel-debug.apk", "cn.wuziping.ember.preview07"),
    ]


def packaged_assets(archive: zipfile.ZipFile) -> dict[str, str]:
    found: dict[str, str] = {}
    for name in archive.namelist():
        if not name.startswith("assets/") or name.endswith("/"):
            continue
        logical = name[len("assets/"):].replace("\\", "/")
        found.setdefault(logical, name)
    return found


def check_assets(archive: zipfile.ZipFile) -> tuple[list[str], list[str], list[str]]:
    root = ROOT / "app" / "src" / "main" / "assets"
    packaged = packaged_assets(archive)
    bad: list[str] = []
    newlines: list[str] = []
    for logical, stored in sorted(packaged.items()):
        source = root / logical
        if not source.is_file():
            bad.append(f"{logical} is in the APK but not in app/src/main/assets")
            continue
        kind = bytes_match(archive.read(stored), source.read_bytes())
        if kind is None:
            bad.append(f"{logical} differs from source")
        elif kind == "newline":
            newlines.append(logical)
    extra = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        logical = path.relative_to(root).as_posix()
        if logical not in packaged:
            extra.append(logical)
    return bad, newlines, extra


def run_sdk_checks(path: Path, package: str, version) -> None:
    java = resolve_java()
    zipalign = resolve_sdk_tool(None, "zipalign")
    aapt = resolve_sdk_tool(None, "aapt")
    apksigner = resolve_sdk_tool(None, "apksigner")
    if apksigner is None:
        lib = None
    else:
        lib = apksigner.parent / "lib" / "apksigner.jar"
        if not lib.is_file():
            lib = None
    if java and lib:
        signature = subprocess.check_output(
            [str(java), "-jar", str(lib), "verify", "--verbose", "--print-certs", str(path)],
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if "Verified using v2 scheme (APK Signature Scheme v2): true" not in signature:
            raise AssertionError("v2 signature was not verified")
        record(f"signature {path.name}", "PASS", "v2 signature verified")
    else:
        record(f"signature {path.name}", "SKIP", "java or apksigner.jar is not on this machine")
    if zipalign:
        subprocess.run([str(zipalign), "-c", "4", str(path)], check=True)
        record(f"alignment {path.name}", "PASS", "zipalign -c 4")
    else:
        record(f"alignment {path.name}", "SKIP", "zipalign is not on this machine")
    if aapt:
        meta = subprocess.check_output(
            [str(aapt), "dump", "badging", str(path)],
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        expected = f"package: name='{package}' versionCode='{version.version_code}' versionName='{version.version_name}'"
        if expected not in meta:
            raise AssertionError(f"badging missing {expected}")
        if "launchable-activity: name='cn.wuziping.ember.MainActivity'" not in meta:
            raise AssertionError("launchable activity is not MainActivity")
        record(f"badging {path.name}", "PASS", expected)
    else:
        record(f"badging {path.name}", "SKIP", "aapt is not on this machine")


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
    print("Logic suites are not counted here. Run tools/verify-desktop.sh for the live Java checks.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jdk-root", default=None, help="JDK root. Defaults to JAVA_HOME, then java on PATH.")
    parser.add_argument("--sdk-root", default=None, help="Android SDK root. Defaults to ANDROID_HOME or ANDROID_SDK_ROOT.")
    args = parser.parse_args(argv)
    if args.jdk_root:
        import os
        os.environ["JAVA_HOME"] = args.jdk_root
    if args.sdk_root:
        import os
        os.environ["ANDROID_SDK_ROOT"] = args.sdk_root

    try:
        version = read_gradle_version(ROOT / "app" / "build.gradle")
        record("gradle version", "PASS", f"{version.version_name} versionCode {version.version_code}")
    except Exception as error:
        record("gradle version", "FAIL", str(error))
        print_table()
        return 1

    checksums = checksum_map(ROOT / "dist" / "SHA256SUMS.txt")
    dexes: list[bytes] = []
    for name, package in apk_names(version.version_name):
        path = ROOT / "dist" / name
        if not path.is_file():
            record(name, "FAIL", "file is not in dist/")
            continue
        digest = sha256_file(path)
        listed = checksums.get(name)
        if listed != digest:
            record(f"checksum {name}", "FAIL", f"listed={listed} computed={digest}")
        else:
            record(f"checksum {name}", "PASS", digest)
        try:
            with zipfile.ZipFile(path) as archive:
                bad_zip = archive.testzip()
                if bad_zip is not None:
                    raise AssertionError(f"corrupt zip entry {bad_zip}")
                dex = archive.read("classes.dex")
                dexes.append(dex)
                missing = [cls for cls in GAME_CLASSES if f"Lcn/wuziping/ember/{cls};".encode() not in dex]
                if missing:
                    raise AssertionError("dex missing " + ", ".join(missing))
                if b"Lcn/wuziping/ember/HistoryJourney;" not in dex:
                    record(
                        f"history class {name}",
                        "KNOWN",
                        "published dex has no HistoryJourney; source has the class, APK was not rebuilt",
                    )
                else:
                    record(f"history class {name}", "PASS", "HistoryJourney is in classes.dex")
                bad, newlines, extra = check_assets(archive)
                if bad:
                    raise AssertionError("; ".join(bad[:6]))
                detail = f"{len(packaged_assets(archive))} packaged assets match source"
                if newlines:
                    detail += f"; newline-only: {', '.join(newlines)}"
                record(f"assets {name}", "PASS", detail)
                if extra:
                    record(
                        f"assets ahead of {name}",
                        "KNOWN",
                        "source files not in this published APK: " + ", ".join(extra),
                    )
            record(f"zip {name}", "PASS", f"package {package}")
            try:
                run_sdk_checks(path, package, version)
            except Exception as error:
                record(f"sdk {name}", "FAIL", f"{type(error).__name__}: {error}")
        except Exception as error:
            record(name, "FAIL", f"{type(error).__name__}: {error}")

    if len(dexes) == 2:
        if dexes[0] == dexes[1]:
            record("dex identity", "PASS", "debug and parallel-debug classes.dex match")
        else:
            record("dex identity", "FAIL", "debug and parallel-debug classes.dex differ")

    print_table()
    failed = any(status == "FAIL" for _, status, _ in RESULTS)
    print(f"EXIT: {'FAIL' if failed else 'PASS'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
