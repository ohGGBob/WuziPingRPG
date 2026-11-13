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


def sdk_bin(sdk_root: Path, tool: str, build_tools: str = "34.0.0", platform: str | None = None) -> Path:
    return Path(sdk_root) / "build-tools" / build_tools / executable_name(tool, platform)


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


def resolve_sdk_tool(sdk_root: str | None, tool: str) -> Path | None:
    roots: list[str] = []
    if sdk_root:
        roots.append(sdk_root)
    for key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        value = os.environ.get(key)
        if value and value not in roots:
            roots.append(value)
    for root in roots:
        found = existing_file(sdk_bin(Path(root), tool))
        if found:
            return found
    return None


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
    parser.add_argument("names", nargs="*", help="APK file names next to the checksum file")
    args = parser.parse_args(argv)
    if args.gradle:
        version = read_gradle_version(args.gradle)
        if args.shell:
            print(version.shell(), end="")
        else:
            print(f"{version.version_code} {version.version_name}")
    if args.merge_checksums:
        merge_checksum_file(args.merge_checksums, list(args.names))
    if not args.gradle and not args.merge_checksums:
        parser.error("pass --gradle and/or --merge-checksums")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
