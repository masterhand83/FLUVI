"""Focused regression tests; no Cargo compilation or graphics device required."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("verify", Path(__file__).with_name("verify.py"))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "results"

    def state(self):
        pointer = json.loads((self.output / "latest.json").read_text())
        return json.loads(Path(pointer["status_file"]).read_text())

    def run_stages(self, commands):
        with contextlib.redirect_stdout(io.StringIO()):
            return verify.run("fixture", list(commands), self.root, self.output, commands)

    def test_success_records_commands_output_and_exit_codes(self):
        code = self.run_stages({
            "first": [sys.executable, "-c", "print('first command output')"],
            "second": [sys.executable, "-c", "print('second command output')"],
        })
        self.assertEqual(code, 0)
        state = self.state()
        self.assertEqual(state["status"], "passed")
        self.assertEqual([s["status"] for s in state["stages"]], ["passed", "passed"])
        self.assertEqual([s["exit_code"] for s in state["stages"]], [0, 0])
        self.assertEqual(
            Path(state["stages"][0]["log"]).read_text().strip(), "first command output",
        )
        self.assertEqual(
            state["stages"][1]["command"],
            [sys.executable, "-c", "print('second command output')"],
        )
        self.assertGreaterEqual(state["elapsed_seconds"], 0)

    def test_failure_stops_before_next_stage(self):
        code = self.run_stages({
            "fail": [sys.executable, "-c", "raise SystemExit(7)"],
            "unreached": [sys.executable, "-c", "raise RuntimeError('must not run')"],
        })
        self.assertEqual(code, 7)
        state = self.state()
        self.assertEqual(state["status"], "failed")
        self.assertEqual([s["status"] for s in state["stages"]], ["failed", "pending"])
        self.assertFalse(Path(state["stages"][1]["log"]).exists())

    def test_missing_command_is_a_recorded_failure(self):
        self.assertEqual(self.run_stages({"missing": [str(self.root / "no-command")]}), 127)
        self.assertEqual(self.state()["stages"][0]["exit_code"], 127)
        self.assertIn("cannot start stage", Path(self.state()["stages"][0]["log"]).read_text())

    def test_workflows_keep_release_explicit(self):
        self.assertEqual(verify.WORKFLOWS["edit"], ["check"])
        self.assertEqual(verify.WORKFLOWS["ci"], ["fmt", "tooling", "lint", "test"])
        self.assertEqual(verify.WORKFLOWS["delivery"], ["fmt", "tooling", "lint", "test", "smoke"])
        self.assertEqual(verify.COMMANDS["release"], ["cargo", "build", "--release"])

    def test_ci_driver_stays_independent_of_app_dependencies(self):
        # Cargo resolves the manifest graph without compiling any package.
        result = subprocess.run(
            ["cargo", "metadata", "--locked", "--no-deps", "--format-version", "1"],
            cwd=verify.ROOT, capture_output=True, text=True, check=True,
        )
        packages = {package["name"]: package for package in json.loads(result.stdout)["packages"]}
        self.assertEqual(packages["ca-dev"]["dependencies"], [])
        self.assertNotIn("cargo-ci", [target["name"] for target in packages["ca-app"]["targets"]])

    def test_status_before_any_run_is_not_success(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(verify.show_status(self.output), 1)
        self.assertIn("No verification run recorded", output.getvalue())

    def test_unrecorded_termination_is_not_reported_as_a_pass(self):
        self.output.mkdir()
        status = self.output / "status.json"
        verify.write_json(status, {
            "status": "running", "pid": 123,
            "started_at": "2000-01-01T00:00:00+00:00",
        })
        verify.write_json(self.output / "latest.json", {"status_file": str(status)})
        with patch.object(verify.os, "kill", side_effect=ProcessLookupError):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(verify.show_status(self.output), 0)
        self.assertEqual(
            json.loads(output.getvalue())["status"], "interrupted (no completion record)",
        )

    @unittest.skipUnless(os.name == "posix", "process-group cancellation is POSIX-specific")
    def test_cancellation_records_state_and_stops_descendants(self):
        # The child requests cancellation only after starting its descendant.
        program = """
import importlib.util, os, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('verify', sys.argv[1])
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
stage = [
    sys.executable, '-c',
    "import os, signal, subprocess, sys; "
    "p = subprocess.Popen([sys.executable, '-c', 'import signal; signal.pause()']); "
    "print(p.pid, flush=True); "
    f"os.kill(os.getppid(), {int(sys.argv[3])}); signal.pause()"
]
raise SystemExit(verify.run(
    'cancel', ['done', 'waiting', 'unreached'], Path(sys.argv[2]), Path(sys.argv[2]) / 'results',
    {
        'done': [sys.executable, '-c', "print('completed stage')"],
        'waiting': stage,
        'unreached': [sys.executable, '-c', 'raise SystemExit(99)'],
    },
))
"""
        for signum in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=signum):
                directory = self.root / str(signum)
                directory.mkdir()
                self.output = directory / "results"
                process = subprocess.Popen(
                    [sys.executable, "-c", program, str(Path(verify.__file__)), str(directory), str(signum)],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                )
                try:
                    output, _ = process.communicate(timeout=10)
                    self.assertEqual(process.returncode, 128 + signum, output.decode())
                    state = self.state()
                    self.assertEqual(state["status"], "cancelled")
                    self.assertEqual(
                        [s["status"] for s in state["stages"]],
                        ["passed", "cancelled", "pending"],
                    )
                    self.assertEqual(state["stages"][0]["exit_code"], 0)
                    child_pid = int(Path(state["stages"][1]["log"]).read_text().strip())
                    # A killed orphan can remain as a zombie until the OS reaps it.
                    stat = Path(f"/proc/{child_pid}/stat")
                    if stat.exists():
                        self.assertEqual(stat.read_text().split()[2], "Z")
                finally:
                    if process.poll() is None:
                        process.terminate()
                        process.communicate(timeout=10)


if __name__ == "__main__":
    unittest.main()
