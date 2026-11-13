"""Regression checks for the verification entry points. No APK is built."""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import verify_support


def load_interface():
    path = Path(__file__).resolve().parent / "verify-interface-fix.py"
    spec = importlib.util.spec_from_file_location("verify_interface_fix", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ROOT = verify_support.ROOT


class GradleAndTools(unittest.TestCase):
    def test_fixture_versions_round_trip(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "build.gradle"
            path.write_text("defaultConfig { versionCode 58; versionName '0.3.18' }\n", encoding="utf-8")
            parsed = verify_support.read_gradle_version(path)
        self.assertEqual(parsed.version_code, 58)
        self.assertEqual(parsed.version_name, "0.3.18")
        self.assertIn("VERSION_CODE=58\n", parsed.shell())

    def test_live_gradle_files_parse(self):
        game = verify_support.read_gradle_version(ROOT / "app" / "build.gradle")
        studio = verify_support.read_gradle_version(ROOT / "studio" / "build.gradle")
        self.assertGreater(game.version_code, 0)
        self.assertGreater(studio.version_code, 0)
        self.assertNotEqual(studio.version_name, "0.2.7")
        self.assertNotEqual(game.version_name, "0.7.0")

    def test_executable_names_follow_the_platform(self):
        self.assertEqual(verify_support.executable_name("java.exe", "posix"), "java")
        self.assertEqual(verify_support.executable_name("zipalign", "posix"), "zipalign")
        self.assertEqual(verify_support.executable_name("aapt", "nt"), "aapt.exe")
        self.assertEqual(verify_support.executable_name("java.exe", "nt"), "java.exe")
        java = verify_support.java_bin(Path("/opt/jdk"), "posix")
        self.assertEqual(java, Path("/opt/jdk/bin/java"))

    def test_checksum_lines_accept_both_sha256sum_forms(self):
        text = (
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *dist/Ember-Studio-0.3.10.apk\n"
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  Ember-Studio-0.3.18.apk\n"
        )
        self.assertEqual(
            verify_support.parse_checksums(text),
            [
                ("a" * 64, "Ember-Studio-0.3.10.apk"),
                ("b" * 64, "Ember-Studio-0.3.18.apk"),
            ],
        )

    def test_merge_keeps_older_entries(self):
        existing = "aa" * 32 + "  Ember-Studio-0.3.10.apk\n"
        merged = verify_support.merge_checksum_text(existing, {"Ember-Studio-0.3.18.apk": "bb" * 32})
        names = [name for _, name in verify_support.parse_checksums(merged)]
        self.assertEqual(names, ["Ember-Studio-0.3.10.apk", "Ember-Studio-0.3.18.apk"])

    def test_newline_only_text_matches(self):
        self.assertEqual(verify_support.bytes_match(b"a\r\nb", b"a\nb"), "newline")
        self.assertEqual(verify_support.bytes_match(b"a\nb", b"a\nb"), "exact")
        self.assertIsNone(verify_support.bytes_match(b"\xff", b"\xfe"))

    def test_suite_lists_include_physics_and_history(self):
        desktop = verify_support.read_suite_names(ROOT / "tools" / "java-suites-desktop.txt")
        studio = verify_support.read_suite_names(ROOT / "tools" / "java-suites-studio.txt")
        for name in ("PhysicsTests", "HistoryTests"):
            self.assertIn(name, desktop)
            self.assertIn(name, studio)
            self.assertTrue((ROOT / "tools" / "tests" / f"{name}.java").is_file())
        for script in (
            ROOT / "tools" / "verify-desktop.sh",
            ROOT / "tools" / "verify-desktop.ps1",
            ROOT / "tools" / "verify-studio.sh",
            ROOT / "tools" / "verify-studio.ps1",
        ):
            self.assertIn("java-suites-", script.read_text(encoding="utf-8"))


class Entrypoints(unittest.TestCase):
    def test_scripts_do_not_hardcode_windows_or_stale_versions(self):
        release = (ROOT / "tools" / "verify-release.py").read_text(encoding="utf-8")
        studio = (ROOT / "tools" / "verify-studio-release.py").read_text(encoding="utf-8")
        interface = (ROOT / "tools" / "verify-interface-fix.py").read_text(encoding="utf-8")
        build = (ROOT / "tools" / "build-apk.sh").read_text(encoding="utf-8")
        for text in (release, studio, interface):
            self.assertNotIn("java.exe", text)
            self.assertNotIn("zipalign.exe", text)
            self.assertNotIn("aapt.exe", text)
        self.assertNotIn("versionName='0.7.0'", release)
        self.assertNotIn("versionCode='7'", release)
        self.assertNotIn("354 logic checks", release)
        self.assertNotIn("Ember-Studio-0.2.7.apk", studio)
        self.assertNotIn("versionCode='39'", studio)
        self.assertNotIn("Ember-Studio-0.1.15.apk", interface)
        self.assertIn("build-photo.mjs", interface)
        self.assertNotIn("--version-code 7", build)
        self.assertNotIn("--version-name 0.7.0", build)
        self.assertIn("verify_support.py", build)

    def test_readme_current_versions_match_gradle(self):
        game = verify_support.read_gradle_version(ROOT / "app" / "build.gradle")
        studio = verify_support.read_gradle_version(ROOT / "studio" / "build.gradle")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        studio_readme = (ROOT / "studio" / "README.md").read_text(encoding="utf-8")
        index = (ROOT / "studio" / "web" / "src" / "index.html").read_text(encoding="utf-8")
        self.assertIn(
            f"当前源码版本：游戏 **{game.version_name}**，天工 **{studio.version_name}**（versionCode {studio.version_code}）",
            readme,
        )
        self.assertIn(
            f"当前整合版本为 {studio.version_name}（versionCode {studio.version_code}）",
            studio_readme,
        )
        self.assertIn(f'class="brandver">{studio.version_name}<', index)

    def test_staged_web_tree_includes_photo_build(self):
        with tempfile.TemporaryDirectory() as temp:
            web = load_interface().copy_web_sources(Path(temp))
            self.assertTrue((web / "build.mjs").is_file())
            self.assertTrue((web / "build-photo.mjs").is_file())
            self.assertTrue((web / "src" / "app.js").is_file())
            self.assertIn("build-photo.mjs", (web / "package.json").read_text(encoding="utf-8"))

    def test_current_checksum_files_cover_the_gradle_apk(self):
        studio = verify_support.read_gradle_version(ROOT / "studio" / "build.gradle")
        name = f"Ember-Studio-{studio.version_name}.apk"
        apk = ROOT / "dist" / name
        self.assertTrue(apk.is_file(), name)
        digest = verify_support.sha256_file(apk)
        for checksum in (ROOT / "dist" / "STUDIO-SHA256SUMS.txt", ROOT / "STUDIO-SHA256SUMS.txt"):
            entries = verify_support.checksum_map(checksum)
            self.assertEqual(entries.get(name), digest, checksum)
        game = verify_support.read_gradle_version(ROOT / "app" / "build.gradle")
        game_sums = verify_support.checksum_map(ROOT / "dist" / "SHA256SUMS.txt")
        for suffix in ("debug", "parallel-debug"):
            game_name = f"WuziPing-Emberbound-{game.version_name}-{suffix}.apk"
            self.assertEqual(game_sums.get(game_name), verify_support.sha256_file(ROOT / "dist" / game_name))


class ScriptsRun(unittest.TestCase):
    def test_merged_ui_static_check(self):
        completed = subprocess.run(
            ["node", "tools/test-merged-ui.js"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("SKIP browser", completed.stdout)
        self.assertNotIn("D:/", completed.stdout)

    def test_node_unit_file(self):
        completed = subprocess.run(
            ["node", "--test", "tools/test-merged-ui.test.cjs"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)


if __name__ == "__main__":
    unittest.main()
