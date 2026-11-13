"""Fixtures for the package input check. No APK is built."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import package_preflight
import verify_support


ROOT = Path(__file__).resolve().parents[1]
HISTORY = package_preflight.HISTORY_ASSETS


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def base_tree(root: Path) -> None:
    quoted = ", ".join(f'"{name}"' for name in HISTORY)
    write(root / "core/src/main/java/cn/wuziping/ember/Game.java", "class Game { HistoryJourney history = new HistoryJourney(); }\n")
    write(root / "core/src/main/java/cn/wuziping/ember/HistoryJourney.java", "class HistoryJourney {}\n")
    write(root / "app/src/main/java/cn/wuziping/ember/GameView.java", f"class GameView {{ String[] names = new String[]{{{quoted}}}; }}\n")
    for name in HISTORY:
        write(root / "app/src/main/assets" / name, "png")
    for relative in (
        "studio/web/src/index.html",
        "studio/src/main/assets/studio/index.html",
        "studio/src/main/assets/studio/editor.page",
        "studio/src/main/assets/editor.page",
    ):
        write(root / relative, "<span class=\"brandver\">0.3.18</span>\n")
    write(root / "app/build.gradle", "applicationId 'cn.wuziping.ember'\n")
    write(
        root / "studio/build.gradle",
        "applicationId (studioParallel ? 'cn.wuziping.ember.preview07' : 'cn.wuziping.ember')\n"
        "packaging { jniLibs { excludes += ['lib/x86/**','lib/x86_64/**'] } }\n",
    )


class PreflightFixtures(unittest.TestCase):
    def test_current_tree_includes_history_without_building(self):
        problems, notes = package_preflight.preflight(ROOT)
        self.assertEqual(problems, [])
        self.assertTrue(any("cn.wuziping.ember" in note for note in notes))
        self.assertTrue(any("x86" in note for note in notes))
        classes = package_preflight.classes_under(package_preflight.game_java_roots(ROOT))
        self.assertIn("HistoryJourney", classes)
        assets = package_preflight.referenced_assets(package_preflight.game_java_roots(ROOT))
        for name in HISTORY:
            self.assertIn(name, assets)
            self.assertTrue((ROOT / "app/src/main/assets" / name).is_file())

    def test_class_outside_compile_roots_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_tree(root)
            (root / "core/src/main/java/cn/wuziping/ember/HistoryJourney.java").unlink()
            write(root / "other/src/main/java/cn/wuziping/ember/HistoryJourney.java", "class HistoryJourney {}\n")
            problems, _notes = package_preflight.preflight(root)
        self.assertTrue(any("HistoryJourney" in item and "outside" in item for item in problems), problems)

    def test_missing_history_image_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_tree(root)
            (root / "app/src/main/assets/history_road.png").unlink()
            problems, _notes = package_preflight.preflight(root)
        self.assertTrue(any("history_road.png" in item for item in problems), problems)

    def test_inputs_only_reports_stale_pages_then_prepare_makes_validation_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_tree(root)
            write(root / "studio/src/main/assets/studio/editor.page", "<span class=\"brandver\">0.3.5</span>\n")
            input_problems, input_notes = package_preflight.preflight(root, require_pages=False)
            self.assertEqual(input_problems, [])
            self.assertTrue(any("editor.page" in note for note in input_notes))
            problems, changes = package_preflight.prepare_pages(root)
            self.assertEqual(problems, [])
            self.assertTrue(any("editor.page" in line and "differed" in line for line in changes))
            after, _notes = package_preflight.preflight(root, require_pages=True)
            self.assertEqual(after, [])

    def test_prepare_pages_does_not_hide_a_missing_asset(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_tree(root)
            (root / "app/src/main/assets/history_bandit.png").unlink()
            problems, _changes = package_preflight.prepare_pages(root)
            self.assertEqual(problems, [])
            still, _notes = package_preflight.preflight(root, require_pages=False)
            self.assertTrue(any("history_bandit.png" in item for item in still))

    def test_gradle_tasks_prepare_then_validate_without_a_cycle(self):
        app = (ROOT / "app/build.gradle").read_text(encoding="utf-8")
        studio = (ROOT / "studio/build.gradle").read_text(encoding="utf-8")
        self.assertIn("--inputs-only", app)
        self.assertNotIn("syncStudioPages", app)
        self.assertIn("dependsOn 'packagePreflight'", app)
        app_preflight = app.split("tasks.register('packagePreflight'")[1].split("afterEvaluate")[0]
        self.assertNotIn("preBuild", app_preflight)
        self.assertIn("--prepare-pages", studio)
        self.assertIn("dependsOn 'syncStudioPages'", studio)
        self.assertIn("dependsOn 'packagePreflight'", studio)
        sync = studio.split("tasks.register('syncStudioPages'")[1].split("tasks.register('packagePreflight'")[0]
        preflight = studio.split("tasks.register('packagePreflight'")[1].split("afterEvaluate")[0]
        self.assertNotIn("preBuild", sync)
        self.assertNotIn("packagePreflight", sync)
        self.assertNotIn("preBuild", preflight)
        command = [line for line in preflight.splitlines() if "commandLine" in line][0]
        self.assertNotIn("assemble", command)
        self.assertNotIn("d8", command)
        shell = (ROOT / "tools/build-studio.sh").read_text(encoding="utf-8")
        self.assertLess(shell.index("if ! command -v python3"), shell.index('python3 "$ROOT'))
        self.assertLess(shell.index("--inputs-only"), shell.index("npm run build"))
        self.assertLess(shell.index("npm run build"), shell.index("--prepare-pages"))
        self.assertLess(shell.index("--prepare-pages"), shell.index('package_preflight.py" --root "$ROOT"\n'))

    def test_stale_editor_page_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_tree(root)
            write(root / "studio/src/main/assets/studio/editor.page", "<span class=\"brandver\">0.3.5</span>\n")
            problems, _notes = package_preflight.preflight(root)
        self.assertTrue(any("editor.page" in item for item in problems), problems)

    def test_print_build_tools_selects_the_highest_complete_version(self):
        with tempfile.TemporaryDirectory() as temp:
            sdk = Path(temp)
            for version in ("34.0.0", "36.1.0"):
                directory = sdk / "build-tools" / version / "lib"
                directory.mkdir(parents=True)
                (sdk / "build-tools" / version / "zipalign").write_bytes(b"")
                (sdk / "build-tools" / version / "aapt").write_bytes(b"")
                (directory / "apksigner.jar").write_bytes(b"")
            completed = subprocess.run(
                [sys.executable, str(ROOT / "tools/verify_support.py"), "--sdk-root", str(sdk), "--print-build-tools"],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue(completed.stdout.strip().endswith("36.1.0"))
            pinned = verify_support.locate_release_tools(sdk_root=str(sdk), build_tools="34.0.0")
            self.assertEqual(pinned.build_tools.name, "34.0.0")


if __name__ == "__main__":
    unittest.main()
