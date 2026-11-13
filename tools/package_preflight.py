"""Check the inputs the next game or Studio package would collect.

This does not compile, dex, align, sign, or write an APK. The published 0.7.1
game packages predate HistoryJourney and the five history_*.png files; those
sources are already inside the directories the packagers scan. The check fails
if a later class or asset would be referenced by packaged code but left outside
those directories.

Page copies are a separate step. ``--inputs-only`` checks classes and the
literal asset names below, and only reports page drift. ``--prepare-pages``
copies studio/web/src/index.html onto the packaged copies and prints each file
that differed. The default mode then requires those copies to match. It does
not scan paths built by string concatenation, such as ``"audio/" + name + ".wav"``.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


CLASS_DECL = re.compile(r"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b")
ASSET_REF = re.compile(r'"([A-Za-z0-9_./-]+\.(?:png|wav|webp))"')
TYPE_TOKEN = re.compile(r"\b([A-Z][A-Za-z0-9_]*)\b")
HISTORY_ASSETS = (
    "history_road.png",
    "history_ford.png",
    "history_soldier.png",
    "history_bandit.png",
    "history_commander.png",
)


def game_java_roots(root: Path) -> list[Path]:
    return [root / "core" / "src" / "main" / "java", root / "app" / "src" / "main" / "java"]


def studio_java_roots(root: Path) -> list[Path]:
    return game_java_roots(root) + [root / "studio" / "src" / "main" / "java"]


def game_asset_root(root: Path) -> Path:
    return root / "app" / "src" / "main" / "assets"


def java_files(roots: list[Path]) -> list[Path]:
    files: list[Path] = []
    for folder in roots:
        if folder.is_dir():
            files.extend(sorted(folder.rglob("*.java")))
    return files


def declared_classes(path: Path) -> list[str]:
    return CLASS_DECL.findall(path.read_text(encoding="utf-8"))


def classes_under(roots: list[Path]) -> dict[str, list[Path]]:
    found: dict[str, list[Path]] = {}
    for path in java_files(roots):
        for name in declared_classes(path):
            found.setdefault(name, []).append(path)
    return found


def repo_class_index(root: Path) -> dict[str, list[Path]]:
    found: dict[str, list[Path]] = {}
    for path in sorted(root.rglob("*.java")):
        posix = path.as_posix()
        if "/src/main/java/" not in posix:
            continue
        for name in declared_classes(path):
            found.setdefault(name, []).append(path)
    return found


def is_under(path: Path, roots: list[Path]) -> bool:
    resolved = path.resolve()
    for folder in roots:
        base = folder.resolve()
        if resolved == base or base in resolved.parents:
            return True
    return False


def outside_referenced_classes(root: Path, roots: list[Path]) -> list[str]:
    """Classes that packaged sources name, but that live outside the compile roots."""
    index = repo_class_index(root)
    problems: list[str] = []
    for path in java_files(roots):
        text = path.read_text(encoding="utf-8")
        for name in set(TYPE_TOKEN.findall(text)):
            locations = index.get(name)
            if not locations:
                continue
            if any(is_under(item, roots) for item in locations):
                continue
            problems.append(f"{name} is referenced by {path.relative_to(root)} but is outside the package compile roots")
    return sorted(set(problems))


def referenced_assets(roots: list[Path]) -> list[str]:
    names: set[str] = set()
    for path in java_files(roots):
        for name in ASSET_REF.findall(path.read_text(encoding="utf-8")):
            names.add(name.replace("\\", "/"))
    return sorted(names)


def missing_assets(names: list[str], asset_root: Path) -> list[str]:
    missing = []
    for name in names:
        if not (asset_root / name).is_file():
            missing.append(name)
    return missing


def normalized_text(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")


def studio_page_paths(root: Path) -> list[Path]:
    return [
        root / "studio" / "src" / "main" / "assets" / "studio" / "index.html",
        root / "studio" / "src" / "main" / "assets" / "studio" / "editor.page",
        root / "studio" / "src" / "main" / "assets" / "editor.page",
    ]


def studio_page_problems(root: Path) -> list[str]:
    index = root / "studio" / "web" / "src" / "index.html"
    if not index.is_file():
        return [f"missing {index}"]
    source = normalized_text(index)
    problems = []
    for path in studio_page_paths(root):
        if not path.is_file():
            problems.append(f"missing {path.relative_to(root)}")
        elif normalized_text(path) != source:
            problems.append(f"{path.relative_to(root)} differs from studio/web/src/index.html")
    return problems


def prepare_pages(root: Path) -> tuple[list[str], list[str]]:
    """Copy the authored index onto packaged page files.

    Returns (problems, changes). A previous difference is printed by the caller;
    it is not left in place, and it is not omitted from the output.
    """
    index = root / "studio" / "web" / "src" / "index.html"
    if not index.is_file():
        return [f"missing {index}"], []
    data = index.read_bytes()
    changes = []
    for path in studio_page_paths(root):
        before = path.read_bytes() if path.is_file() else None
        if before == data:
            continue
        state = "was missing" if before is None else "differed"
        changes.append(f"{path.relative_to(root)} {state}; updated from studio/web/src/index.html")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return [], changes


def compatibility_notes(root: Path) -> list[str]:
    app = (root / "app" / "build.gradle").read_text(encoding="utf-8")
    studio = (root / "studio" / "build.gradle").read_text(encoding="utf-8")
    notes = []
    if "cn.wuziping.ember" in app and "cn.wuziping.ember" in studio:
        notes.append("标准包名 cn.wuziping.ember 同时用于游戏和天工，不能并排安装。共存包是 cn.wuziping.ember.preview07。")
    if "lib/x86/**" in studio and "lib/x86_64/**" in studio:
        notes.append("天工打包排除 lib/x86 和 lib/x86_64。已提交的扫描原生库是 ARM，x86 模拟器不能靠这份配置跑扫描。")
    return notes


def preflight(root: Path, require_pages: bool = True) -> tuple[list[str], list[str]]:
    """Return (problems, notes). Page drift fails only when require_pages is set."""
    root = root.resolve()
    problems: list[str] = []
    game_roots = game_java_roots(root)
    studio_roots = studio_java_roots(root)
    for folder in game_roots:
        if not folder.is_dir():
            problems.append(f"missing compile root {folder.relative_to(root)}")
    game_classes = classes_under(game_roots)
    if "HistoryJourney" not in game_classes:
        problems.append("HistoryJourney.java is not inside the game compile roots (core/src/main/java and app/src/main/java)")
    if "HistoryJourney" not in classes_under(studio_roots):
        problems.append("HistoryJourney.java is not inside the Studio compile roots")
    problems.extend(outside_referenced_classes(root, game_roots))
    assets = referenced_assets(game_roots)
    asset_root = game_asset_root(root)
    for name in missing_assets(assets, asset_root):
        problems.append(f"packaged game code references {name}, which is not in app/src/main/assets")
    for name in HISTORY_ASSETS:
        if name not in assets:
            problems.append(f"{name} is no longer referenced by the game sources that the packager compiles")
        elif not (asset_root / name).is_file():
            problems.append(f"{name} is referenced but missing from app/src/main/assets")
    page_drift = studio_page_problems(root)
    notes = []
    if require_pages:
        problems.extend(page_drift)
    else:
        notes.extend(f"page drift before preparation: {item}" for item in page_drift)
    if (root / "app" / "build.gradle").is_file() and (root / "studio" / "build.gradle").is_file():
        notes.extend(compatibility_notes(root))
    return problems, notes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--inputs-only", action="store_true", help="Check classes and literal assets. Report page drift without failing.")
    mode.add_argument("--prepare-pages", action="store_true", help="Copy index.html onto packaged pages and print any previous difference.")
    args = parser.parse_args(argv)
    if args.prepare_pages:
        problems, changes = prepare_pages(args.root)
        for line in changes:
            print(f"PREPARE {line}")
        if not changes and not problems:
            print("PREPARE pages already matched studio/web/src/index.html")
        if problems:
            print("PACKAGE PREFLIGHT FAIL")
            for item in problems:
                print(f"- {item}")
            return 1
        return 0
    problems, notes = preflight(args.root, require_pages=not args.inputs_only)
    game_classes = classes_under(game_java_roots(args.root))
    assets = referenced_assets(game_java_roots(args.root))
    print(f"game classes: {len(game_classes)}")
    print(f"HistoryJourney: {'included' if 'HistoryJourney' in game_classes else 'MISSING'}")
    print("history assets: " + ", ".join(name for name in HISTORY_ASSETS if name in assets))
    for note in notes:
        print(f"NOTE {note}")
    if problems:
        print("PACKAGE PREFLIGHT FAIL")
        for item in problems:
            print(f"- {item}")
        return 1
    print("PACKAGE PREFLIGHT PASS")
    print("Next approved package can see HistoryJourney and the five history images. This did not build an APK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
