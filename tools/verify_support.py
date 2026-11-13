"""Cross-platform helpers for the repo verification entry points.

Versions come from the Gradle files. Tool names drop ``.exe`` on non-Windows.
Checksum lines accept both ``sha256sum`` text mode (two spaces) and binary mode
(space, asterisk). This module does not build or sign an APK.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_CODE_RE = re.compile(r"versionCode\s+(\d+)")
VERSION_NAME_RE = re.compile(r"versionName\s+'([^']+)'")
CHECKSUM_RE = re.compile(r"^([0-9a-fA-F]{64})\s+\*?(\S.*?)\s*$")
SAFE_VERSION_NAME = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+-]*$")


@dataclass(frozen=True)
class GradleVersion:
    version_code: int
    version_name: str
    path: Path

    def shell(self) -> str:
        if not SAFE_VERSION_NAME.fullmatch(self.version_name):
            raise ValueError(f"unsafe versionName: {self.version_name!r}")
        return f"VERSION_CODE={self.version_code}\nVERSION_NAME={self.version_name}\n"


def read_gradle_version(path: Path) -> GradleVersion:
    text = Path(path).read_text(encoding="utf-8")
    code = VERSION_CODE_RE.search(text)
    name = VERSION_NAME_RE.search(text)
    if not code or not name:
        raise ValueError(f"versionCode/versionName not found in {path}")
    return GradleVersion(int(code.group(1)), name.group(1), Path(path))


def executable_name(tool: str, platform: str | None = None) -> str:
    """Return the platform file name. ``java.exe`` on POSIX becomes ``java``."""
    plat = os.name if platform is None else platform
    stem = tool[:-4] if tool.lower().endswith(".exe") else tool
    if not stem or "/" in stem or "\\" in stem:
        raise ValueError(f"not a tool name: {tool!r}")
    return stem + ".exe" if plat == "nt" else stem


def java_bin(jdk_root: Path, platform: str | None = None) -> Path:
    return Path(jdk_root) / "bin" / executable_name("java", platform)


def sdk_bin(sdk_root: Path, tool: str, build_tools: str, platform: str | None = None) -> Path:
    return Path(sdk_root) / "build-tools" / build_tools / executable_name(tool, platform)


def version_sort_key(name: str) -> tuple:
    """Release versions sort above prereleases. 36.1.0 > 34.0.0 > 34.0.0-rc1."""
    match = re.match(r"^(\d+(?:\.\d+)*)(.*)$", name)
    if not match:
        return ((0,), 0, name)
    numbers = tuple(int(part) for part in match.group(1).split("."))
    suffix = match.group(2)
    return (numbers, 1 if suffix == "" else 0, name)


VERIFY_TOOLS = ("zipalign", "aapt", "apksigner.jar")
BUILD_TOOLS = ("zipalign", "aapt", "aapt2", "apksigner.jar", "d8.jar")


def release_tool_paths(directory: Path, platform: str | None = None) -> dict[str, Path]:
    return {
        "zipalign": directory / executable_name("zipalign", platform),
        "aapt": directory / executable_name("aapt", platform),
        "aapt2": directory / executable_name("aapt2", platform),
        "apksigner.jar": directory / "lib" / "apksigner.jar",
        "d8.jar": directory / "lib" / "d8.jar",
    }


def required_tool_names(profile: str = "verify") -> tuple[str, ...]:
    if profile == "verify":
        return VERIFY_TOOLS
    if profile == "build":
        return BUILD_TOOLS
    raise ValueError(f"unknown build-tools profile {profile!r}")


def missing_release_tools(directory: Path, platform: str | None = None, profile: str = "verify") -> list[str]:
    paths = release_tool_paths(directory, platform)
    return [name for name in required_tool_names(profile) if not paths[name].is_file()]


def choose_build_tools(
    sdk_root: Path,
    explicit: str | None = None,
    platform: str | None = None,
    profile: str = "verify",
) -> Path | None:
    """Pick one build-tools directory.

    ``verify`` needs zipalign, aapt, and lib/apksigner.jar. ``build`` also needs
    aapt2 and lib/d8.jar. An explicit version is used only when it satisfies
    that profile. It does not fall back to another install. Otherwise the
    highest release that satisfies the profile wins.
    """
    root = Path(sdk_root)
    if explicit:
        candidate = root / "build-tools" / explicit
        if missing_release_tools(candidate, platform, profile):
            return None
        return candidate
    base = root / "build-tools"
    if not base.is_dir():
        return None
    complete = [
        path for path in base.iterdir()
        if path.is_dir() and not missing_release_tools(path, platform, profile)
    ]
    if not complete:
        return None
    return max(complete, key=lambda path: version_sort_key(path.name))


def sdk_search_roots(explicit: str | None = None) -> list[Path]:
    if explicit:
        return [Path(explicit)]
    roots: list[Path] = []
    for key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        value = os.environ.get(key)
        if not value:
            continue
        path = Path(value)
        if path not in roots:
            roots.append(path)
    return roots


@dataclass(frozen=True)
class ReleaseTools:
    java: Path | None
    build_tools: Path | None
    zipalign: Path | None
    aapt: Path | None
    apksigner_jar: Path | None
    java_detail: str
    sdk_detail: str


def locate_release_tools(
    jdk_root: str | None = None,
    sdk_root: str | None = None,
    build_tools: str | None = None,
    platform: str | None = None,
    profile: str = "verify",
) -> ReleaseTools:
    java = resolve_java(jdk_root)
    java_detail = "" if java else "java is not on this machine; set JAVA_HOME or pass --jdk-root"
    explicit = build_tools if build_tools else (os.environ.get("ANDROID_BUILD_TOOLS") or "").strip() or None
    roots = sdk_search_roots(sdk_root)
    chosen: Path | None = None
    if not roots:
        sdk_detail = "Android SDK root is not set; pass --sdk-root or set ANDROID_HOME"
    else:
        reasons: list[str] = []
        for root in roots:
            chosen = choose_build_tools(root, explicit, platform, profile)
            if chosen:
                break
            needed = ", ".join(required_tool_names(profile))
            if explicit:
                missing = missing_release_tools(root / "build-tools" / explicit, platform, profile)
                listed = ", ".join(missing) if missing else "directory is absent"
                reasons.append(
                    f"{root}: build-tools/{explicit} is not complete ({listed}); explicit version does not fall back"
                )
            else:
                reasons.append(f"{root}: no build-tools directory contains {needed}")
        sdk_detail = "" if chosen else " ".join(reasons)
    paths = release_tool_paths(chosen, platform) if chosen else {}
    return ReleaseTools(
        java=java,
        build_tools=chosen,
        zipalign=paths.get("zipalign"),
        aapt=paths.get("aapt"),
        apksigner_jar=paths.get("apksigner.jar"),
        java_detail=java_detail,
        sdk_detail=sdk_detail,
    )


def existing_file(path: Path | None) -> Path | None:
    if path is None:
        return None
    candidate = Path(path)
    return candidate if candidate.is_file() else None


def resolve_java(jdk_root: str | None = None) -> Path | None:
    if jdk_root:
        return existing_file(java_bin(Path(jdk_root)))
    env = os.environ.get("JAVA_HOME")
    if env:
        found = existing_file(java_bin(Path(env)))
        if found:
            return found
    from shutil import which

    located = which("java")
    return Path(located) if located else None


def resolve_sdk_tool(sdk_root: str | None, tool: str, build_tools: str | None = None, platform: str | None = None) -> Path | None:
    """Backward-compatible lookup. Prefer locate_release_tools for release checks."""
    found = locate_release_tools(sdk_root=sdk_root, build_tools=build_tools, platform=platform)
    if tool == "apksigner":
        return found.apksigner_jar
    if tool == "zipalign":
        return found.zipalign
    if tool == "aapt":
        return found.aapt
    if found.build_tools is None:
        return None
    return existing_file(found.build_tools / executable_name(tool, platform))


def checksum_name(raw: str) -> str:
    name = raw.strip().replace("\\", "/")
    if name.startswith("./"):
        name = name[2:]
    if name.startswith("dist/"):
        name = name[5:]
    return Path(name).name


def parse_checksum_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    match = CHECKSUM_RE.match(stripped)
    if not match:
        return None
    return match.group(1).lower(), checksum_name(match.group(2))


def parse_checksums(text: str) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    for line in text.splitlines():
        parsed = parse_checksum_line(line)
        if parsed:
            entries.append(parsed)
    return entries


def load_checksums(path: Path) -> list[tuple[str, str]]:
    if not path.is_file():
        return []
    return parse_checksums(path.read_text(encoding="utf-8"))


def checksum_map(path: Path) -> dict[str, str]:
    """Map packaged file name to digest. Later lines win for a repeated name."""
    found: dict[str, str] = {}
    for digest, name in load_checksums(path):
        found[name] = digest
    return found


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bytes_match(left: bytes, right: bytes) -> str | None:
    """Return ``exact`` or ``newline`` when the payloads agree, else None."""
    if left == right:
        return "exact"
    try:
        left_text = left.decode("utf-8")
        right_text = right.decode("utf-8")
    except UnicodeDecodeError:
        return None
    def norm(value: str) -> str:
        return value.replace("\r\n", "\n").replace("\r", "\n")
    if norm(left_text) == norm(right_text):
        return "newline"
    return None


def merge_checksum_text(existing: str, updates: dict[str, str]) -> str:
    """Replace digests for ``updates`` and keep every other parsed entry."""
    kept: list[tuple[str, str]] = []
    seen: set[str] = set()
    for digest, name in parse_checksums(existing):
        if name in updates:
            digest = updates[name]
        if name in seen:
            continue
        seen.add(name)
        kept.append((digest, name))
    for name, digest in updates.items():
        if name not in seen:
            kept.append((digest, name))
            seen.add(name)
    if not kept:
        return ""
    return "".join(f"{digest}  {name}\n" for digest, name in kept)


def merge_checksum_file(checksum_path: Path, names: list[str]) -> None:
    directory = checksum_path.parent
    existing = checksum_path.read_text(encoding="utf-8") if checksum_path.is_file() else ""
    updates: dict[str, str] = {}
    for name in names:
        path = directory / name
        if path.is_file():
            updates[name] = sha256_file(path)
    checksum_path.write_text(merge_checksum_text(existing, updates), encoding="utf-8")


STATUSES = ("PASS", "FAIL", "SKIP", "KNOWN", "NOTE")


def gate_verdict(results: list[tuple[str, str, str]], strict: bool = False) -> tuple[int, str, dict[str, int]]:
    """Decide how a verification run ends.

    Dev mode exits 0 unless a row is FAIL. SKIP and KNOWN stay visible, and the
    verdict is INCOMPLETE so the log cannot be read as a finished release.
    Strict mode exits non-zero when any required tool was skipped or a known
    resource gap is still recorded. NOTE is informational and blocks neither mode.
    """
    counts = {status: 0 for status in STATUSES}
    for _, status, _ in results:
        if status not in counts:
            raise ValueError(f"unknown status {status!r}")
        counts[status] += 1
    if counts["FAIL"] or (strict and (counts["SKIP"] or counts["KNOWN"])):
        return 1, "FAIL", counts
    if counts["SKIP"] or counts["KNOWN"]:
        return 0, "INCOMPLETE", counts
    return 0, "PASS", counts


def render_gate(results: list[tuple[str, str, str]], strict: bool = False) -> tuple[int, str]:
    code, verdict, counts = gate_verdict(results, strict)
    mode = "strict" if strict else "dev"
    lines = [
        (
            f"SUMMARY: mode={mode} PASS={counts['PASS']} FAIL={counts['FAIL']} "
            f"SKIP={counts['SKIP']} KNOWN={counts['KNOWN']} NOTE={counts['NOTE']}"
        )
    ]
    if verdict == "INCOMPLETE":
        lines.append("开发检查结束。仍有 SKIP 或 KNOWN。完整发行请再跑同一脚本的 --strict；缺口还在时该命令会失败。")
    elif verdict == "FAIL" and strict:
        lines.append("严格发行门槛未通过。")
    elif verdict == "FAIL":
        lines.append("开发检查未通过。")
    else:
        lines.append("本次列出的检查全部通过。")
    lines.append(f"EXIT: {verdict}")
    return code, "\n".join(lines) + "\n"


def is_known_gap_only(results: list[tuple[str, str, str]]) -> bool:
    """Strict failure caused only by SKIP and/or KNOWN, with no FAIL row.

    A checksum mismatch or other FAIL must not count as the expected published-gap result.
    """
    code, verdict, counts = gate_verdict(results, strict=True)
    return code == 1 and verdict == "FAIL" and counts["FAIL"] == 0 and counts["KNOWN"] > 0


def summary_is_known_gap_only(text: str) -> bool:
    matched = False
    exited = False
    for line in text.splitlines():
        if re.match(
            r"SUMMARY: mode=strict PASS=\d+ FAIL=0 SKIP=\d+ KNOWN=[1-9]\d* NOTE=\d+$",
            line,
        ):
            matched = True
        if line == "EXIT: FAIL":
            exited = True
    return matched and exited


def read_suite_names(path: Path) -> list[str]:
    names: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", stripped):
            raise ValueError(f"bad suite name in {path}: {stripped!r}")
        names.append(stripped)
    if not names:
        raise ValueError(f"no suite names in {path}")
    return names


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print Gradle versions or merge checksum lines.")
    parser.add_argument("--gradle", type=Path, help="Gradle file to read")
    parser.add_argument("--shell", action="store_true", help="Print VERSION_CODE and VERSION_NAME shell assignments")
    parser.add_argument("--merge-checksums", type=Path, help="Checksum file to update in place")
    parser.add_argument("--sdk-root", type=Path, help="Android SDK root for --print-build-tools")
    parser.add_argument("--build-tools", help="Exact build-tools version. Does not fall back.")
    parser.add_argument("--print-build-tools", action="store_true", help="Print the selected build-tools directory")
    parser.add_argument("--for-build", action="store_true", help="With --print-build-tools, also require aapt2 and lib/d8.jar")
    parser.add_argument("names", nargs="*", help="APK file names next to the checksum file")
    args = parser.parse_args(argv)
    if args.print_build_tools:
        found = locate_release_tools(
            sdk_root=str(args.sdk_root) if args.sdk_root else None,
            build_tools=args.build_tools,
            profile="build" if args.for_build else "verify",
        )
        if found.build_tools is None:
            print(found.sdk_detail or "build-tools not found", file=sys.stderr)
            return 1
        print(found.build_tools)
    if args.gradle:
        version = read_gradle_version(args.gradle)
        if args.shell:
            print(version.shell(), end="")
        else:
            print(f"{version.version_code} {version.version_name}")
    if args.merge_checksums:
        merge_checksum_file(args.merge_checksums, list(args.names))
    if not args.gradle and not args.merge_checksums and not args.print_build_tools:
        parser.error("pass --gradle, --merge-checksums, and/or --print-build-tools")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
