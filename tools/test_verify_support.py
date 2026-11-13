"""Regression checks for the verification entry points. No APK is built."""
from __future__ import annotations

import importlib.util
import os
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


class Gate(unittest.TestCase):
    def test_success_path_passes_in_both_modes(self):
        rows = [("checksum", "PASS", "ok"), ("assets", "PASS", "ok")]
        for strict in (False, True):
            code, verdict, _counts = verify_support.gate_verdict(rows, strict)
            self.assertEqual((code, verdict), (0, "PASS"))
            text = verify_support.render_gate(rows, strict)[1]
            self.assertIn("EXIT: PASS", text)
            self.assertNotIn("EXIT: INCOMPLETE", text)

    def test_dev_mode_keeps_gaps_visible_without_claiming_release(self):
        rows = [
            ("checksum", "PASS", "ok"),
            ("badging", "SKIP", "aapt is not on this machine"),
            ("history class", "KNOWN", "published dex has no HistoryJourney"),
            ("parallel apk", "NOTE", "standard package only"),
        ]
        code, verdict, counts = verify_support.gate_verdict(rows, strict=False)
        self.assertEqual(code, 0)
        self.assertEqual(verdict, "INCOMPLETE")
        self.assertEqual(counts["NOTE"], 1)
        text = verify_support.render_gate(rows, strict=False)[1]
        self.assertIn("EXIT: INCOMPLETE", text)
        self.assertNotIn("EXIT: PASS", text)

    def test_strict_mode_fails_on_missing_tools_and_known_gaps(self):
        for status, detail in (
            ("SKIP", "zipalign is not on this machine"),
            ("KNOWN", "source files not in this published APK: history_road.png"),
        ):
            rows = [("checksum", "PASS", "ok"), ("gap", status, detail)]
            code, verdict, _counts = verify_support.gate_verdict(rows, strict=True)
            self.assertEqual((code, verdict), (1, "FAIL"), status)
            text = verify_support.render_gate(rows, strict=True)[1]
            self.assertIn("EXIT: FAIL", text)
            self.assertNotIn("EXIT: PASS", text)
            self.assertIn(detail, "\n".join(item[2] for item in rows))

    def test_strict_mode_ignores_informational_notes(self):
        rows = [("apk", "PASS", "ok"), ("parallel apk", "NOTE", "not published")]
        code, verdict, _counts = verify_support.gate_verdict(rows, strict=True)
        self.assertEqual((code, verdict), (0, "PASS"))

    def test_a_real_byte_drift_is_not_accepted_as_newline(self):
        self.assertIsNone(verify_support.bytes_match(b"history-art-v1", b"history-art-v2"))
        self.assertEqual(verify_support.bytes_match(b"a\r\nb", b"a\nb"), "newline")

    def test_hard_failure_blocks_dev_mode(self):
        rows = [("checksum", "FAIL", "hash mismatch")]
        code, verdict, _counts = verify_support.gate_verdict(rows, strict=False)
        self.assertEqual((code, verdict), (1, "FAIL"))

    def test_tools_present_and_only_known_gaps_stay_a_strict_failure(self):
        rows = [
            ("java", "PASS", "/usr/bin/java"),
            ("build-tools", "PASS", "/opt/android-sdk/build-tools/36.1.0"),
            ("signature", "PASS", "v2"),
            ("history class", "KNOWN", "published dex has no HistoryJourney"),
            ("assets ahead", "KNOWN", "history_road.png"),
        ]
        self.assertTrue(verify_support.is_known_gap_only(rows))
        text = verify_support.render_gate(rows, strict=True)[1]
        self.assertTrue(verify_support.summary_is_known_gap_only(text))
        self.assertIn("FAIL=0", text)
        self.assertIn("SKIP=0", text)

    def test_an_extra_fail_is_not_covered_by_known_gaps(self):
        rows = [
            ("java", "PASS", "/usr/bin/java"),
            ("build-tools", "PASS", "/opt/android-sdk/build-tools/36.1.0"),
            ("checksum", "FAIL", "hash mismatch"),
            ("history class", "KNOWN", "published dex has no HistoryJourney"),
        ]
        self.assertFalse(verify_support.is_known_gap_only(rows))
        code, text = verify_support.render_gate(rows, strict=True)
        self.assertEqual(code, 1)
        self.assertIn("EXIT: FAIL", text)
        self.assertIn("FAIL=1", text)
        self.assertFalse(verify_support.summary_is_known_gap_only(text))

    def test_complete_success_is_a_strict_pass(self):
        rows = [
            ("java", "PASS", "/usr/bin/java"),
            ("build-tools", "PASS", "/opt/android-sdk/build-tools/36.1.0"),
            ("apk", "PASS", "ok"),
        ]
        code, verdict, counts = verify_support.gate_verdict(rows, strict=True)
        self.assertEqual((code, verdict), (0, "PASS"))
        self.assertEqual((counts["FAIL"], counts["SKIP"], counts["KNOWN"]), (0, 0, 0))
        self.assertFalse(verify_support.is_known_gap_only(rows))


class BuildToolsSelection(unittest.TestCase):
    def setUp(self):
        self._saved = {
            key: os.environ.get(key)
            for key in ("ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_BUILD_TOOLS")
        }
        for key in self._saved:
            os.environ.pop(key, None)

    def tearDown(self):
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def plant(self, root: Path, version: str, tools=("zipalign", "aapt", "apksigner.jar")):
        directory = root / "build-tools" / version
        (directory / "lib").mkdir(parents=True)
        if "zipalign" in tools:
            (directory / "zipalign").write_bytes(b"")
        if "aapt" in tools:
            (directory / "aapt").write_bytes(b"")
        if "apksigner.jar" in tools:
            (directory / "lib" / "apksigner.jar").write_bytes(b"")
        if "aapt2" in tools:
            (directory / "aapt2").write_bytes(b"")
        if "d8.jar" in tools:
            (directory / "lib" / "d8.jar").write_bytes(b"")
        return directory

    def test_highest_complete_version_wins(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.plant(root, "34.0.0")
            self.plant(root, "36.1.0")
            self.plant(root, "36.1.0-rc1")
            chosen = verify_support.choose_build_tools(root)
            self.assertEqual(chosen.name, "36.1.0")

    def test_explicit_version_beats_a_newer_install(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.plant(root, "34.0.0")
            self.plant(root, "36.1.0")
            chosen = verify_support.choose_build_tools(root, explicit="34.0.0")
            self.assertEqual(chosen.name, "34.0.0")

    def test_explicit_missing_version_does_not_fall_back(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.plant(root, "36.1.0")
            self.assertIsNone(verify_support.choose_build_tools(root, explicit="34.0.0"))
            found = verify_support.locate_release_tools(sdk_root=str(root), build_tools="34.0.0")
            self.assertIsNone(found.build_tools)
            self.assertIn("does not fall back", found.sdk_detail)
            self.assertNotIn("java is not", found.sdk_detail)

    def test_incomplete_newer_directory_loses_to_a_complete_older_one(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.plant(root, "36.1.0", tools=("zipalign",))
            self.plant(root, "34.0.0")
            chosen = verify_support.choose_build_tools(root)
            self.assertEqual(chosen.name, "34.0.0")

    def test_no_tools_and_missing_java_are_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            sdk = Path(temp) / "sdk"
            sdk.mkdir()
            jdk = Path(temp) / "jdk"
            found = verify_support.locate_release_tools(jdk_root=str(jdk), sdk_root=str(sdk))
            self.assertIsNone(found.java)
            self.assertIsNone(found.build_tools)
            self.assertIn("java is not on this machine", found.java_detail)
            self.assertNotIn("apksigner", found.java_detail)
            self.assertIn("no build-tools directory", found.sdk_detail)
            self.assertNotIn("java", found.sdk_detail)

    def test_build_profile_skips_a_newer_dir_that_lacks_d8(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.plant(root, "36.1.0")
            self.plant(root, "34.0.0", tools=("zipalign", "aapt", "apksigner.jar", "aapt2", "d8.jar"))
            verify_choice = verify_support.choose_build_tools(root, profile="verify")
            build_choice = verify_support.choose_build_tools(root, profile="build")
            self.assertEqual(verify_choice.name, "36.1.0")
            self.assertEqual(build_choice.name, "34.0.0")

    def test_print_build_tools_cli_reports_a_missing_sdk_without_traceback(self):
        with tempfile.TemporaryDirectory() as temp:
            sdk = Path(temp)
            (sdk / "build-tools").mkdir()
            completed = subprocess.run(
                [sys.executable, str(verify_support.ROOT / "tools/verify_support.py"),
                 "--sdk-root", str(sdk), "--print-build-tools"],
                check=False, capture_output=True, text=True,
            )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout, "")
        self.assertNotIn("Traceback", completed.stderr)
        self.assertNotIn("NameError", completed.stderr)
        self.assertIn("no build-tools directory contains", completed.stderr)

    def test_print_build_tools_cli_explicit_incomplete_does_not_fall_back(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.plant(root, "36.1.0", tools=("zipalign", "aapt", "apksigner.jar", "aapt2", "d8.jar"))
            self.plant(root, "34.0.0", tools=("zipalign",))
            completed = subprocess.run(
                [sys.executable, str(verify_support.ROOT / "tools/verify_support.py"),
                 "--sdk-root", str(root), "--build-tools", "34.0.0", "--print-build-tools", "--for-build"],
                check=False, capture_output=True, text=True,
            )
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(completed.stdout, "")
        self.assertNotIn("Traceback", completed.stderr)
        self.assertNotIn("36.1.0", completed.stdout + completed.stderr)
        self.assertIn("does not fall back", completed.stderr)
        self.assertIn("d8.jar", completed.stderr)

    def test_android_home_finds_36_without_a_34_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.plant(root, "36.1.0")
            os.environ["ANDROID_HOME"] = str(root)
            found = verify_support.locate_release_tools()
            self.assertEqual(found.build_tools.name, "36.1.0")
            self.assertTrue(found.apksigner_jar.is_file())
            self.assertTrue(found.zipalign.is_file())
            self.assertTrue(found.aapt.is_file())


class PublishedPackages(unittest.TestCase):
    def test_dev_check_does_not_claim_a_finished_release(self):
        for script in ("tools/verify-release.py", "tools/verify-studio-release.py"):
            completed = subprocess.run(
                ["python3", script],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("EXIT: INCOMPLETE", completed.stdout)
            self.assertNotIn("EXIT: PASS", completed.stdout)
            self.assertIn("mode=dev", completed.stdout)

    def test_strict_gate_fails_on_the_published_gaps(self):
        game = subprocess.run(
            ["python3", "tools/verify-release.py", "--strict"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(game.returncode, 0)
        self.assertIn("EXIT: FAIL", game.stdout)
        self.assertIn("HistoryJourney", game.stdout)
        self.assertIn("history_road.png", game.stdout)
        self.assertTrue(verify_support.summary_is_known_gap_only(game.stdout), game.stdout)
        self.assertNotIn("java or apksigner", game.stdout)
        studio = subprocess.run(
            ["python3", "tools/verify-studio-release.py", "--strict"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(studio.returncode, 0)
        self.assertIn("EXIT: FAIL", studio.stdout)
        self.assertIn("editor.page", studio.stdout)
        self.assertTrue(verify_support.summary_is_known_gap_only(studio.stdout), studio.stdout)
        self.assertNotIn("java/zipalign/aapt/apksigner not all present", studio.stdout)


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
