"""Run explicit verification stages; preserve Cargo artifacts and record results."""

import argparse
from collections import deque
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parent.parent
COMMANDS = {
    "check": ["cargo", "check", "--workspace", "--all-targets"],
    "fmt": ["cargo", "fmt", "--all", "--", "--check"],
    "tooling": [sys.executable, "-m", "unittest", "discover", "-s", "scripts", "-p", "test_verify.py"],
    "lint": ["cargo", "lint"],
    "test": ["cargo", "t"],
    "smoke": ["cargo", "smoke"],
    "release": ["cargo", "build", "--release"],
}
WORKFLOWS = {
    "edit": ["check"],
    "ci": ["fmt", "tooling", "lint", "test"],
    "delivery": ["fmt", "tooling", "lint", "test", "smoke"],
}


class Cancelled(Exception):
    def __init__(self, signum):
        self.signum = signum


def write_json(path, value):
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def stop_process(process):
    """Stop the stage and its subprocesses, not unrelated Cargo processes."""
    if process is None:
        return
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    elif process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except ProcessLookupError:
            pass
        process.wait()


def run(workflow, stages, root, output, commands=None):
    """Commands may be injected by tests; the CLI only exposes named stages."""
    commands = COMMANDS if commands is None else commands
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + f"-{os.getpid()}"
    directory = output / run_id
    directory.mkdir(parents=True)
    state_path = directory / "status.json"
    state = {
        "workflow": workflow,
        "pid": os.getpid(),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "status": "running",
        "elapsed_seconds": 0,
        "verification_only": True,
        "stages": [
            {
                "name": name,
                "command": commands[name],
                "status": "pending",
                "elapsed_seconds": 0,
                "exit_code": None,
                "log": str(directory / f"{index + 1:02}-{name}.log"),
            }
            for index, name in enumerate(stages)
        ],
    }
    write_json(state_path, state)
    # Select the latest-started run once; older concurrent runs cannot replace it.
    write_json(output / "latest.json", {"status_file": str(state_path)})
    print(f"Verification only; status: {state_path}", flush=True)
    started = time.monotonic()
    process = None
    active = None
    stage_started = started
    exit_code = 0
    cancel_signum = None

    def cancel(signum, _frame):
        # Defer cancellation until the child PID is owned and state writes finish.
        nonlocal cancel_signum
        cancel_signum = signum

    previous = {sig: signal.signal(sig, cancel) for sig in (signal.SIGINT, signal.SIGTERM)}

    def save():
        state["elapsed_seconds"] = round(time.monotonic() - started, 3)
        write_json(state_path, state)

    try:
        for index, stage in enumerate(state["stages"], 1):
            if cancel_signum is not None:
                raise Cancelled(cancel_signum)
            active = stage
            stage_started = time.monotonic()
            stage["status"] = "running"
            stage["started_at"] = datetime.now(timezone.utc).isoformat()
            save()
            print(
                f"[{index}/{len(stages)}] START {stage['name']}: "
                f"{' '.join(stage['command'])}\n  log: {stage['log']}",
                flush=True,
            )
            with open(stage["log"], "wb") as log:
                try:
                    process = subprocess.Popen(
                        stage["command"], cwd=root, stdout=log,
                        stderr=subprocess.STDOUT, start_new_session=True,
                    )
                    stage["pid"] = process.pid
                    save()
                    while True:
                        if cancel_signum is not None:
                            raise Cancelled(cancel_signum)
                        try:
                            result = process.wait(timeout=0.25)
                            break
                        except subprocess.TimeoutExpired:
                            continue
                except OSError as error:
                    log.write(f"cannot start stage: {error}\n".encode())
                    result = 127
            if cancel_signum is not None:
                raise Cancelled(cancel_signum)
            process = None
            stage["elapsed_seconds"] = round(time.monotonic() - stage_started, 3)
            stage["exit_code"] = result
            stage["status"] = "passed" if result == 0 else "failed"
            # Retain a conventional nonzero CLI exit for signal-terminated children.
            exit_code = result if result >= 0 else 128 - result
            save()
            print(
                f"[{index}/{len(stages)}] {stage['status'].upper()} {stage['name']} "
                f"({stage['elapsed_seconds']:.2f}s, exit {result})",
                flush=True,
            )
            if result != 0:
                with open(stage["log"], encoding="utf-8", errors="replace") as log:
                    print("".join(deque(log, maxlen=30)), end="", flush=True)
                break
        state["status"] = "passed" if exit_code == 0 else "failed"
    except Cancelled as cancelled:
        # A second interrupt must not prevent cleanup or recording cancellation.
        for sig in previous:
            signal.signal(sig, signal.SIG_IGN)
        stop_process(process)
        exit_code = 128 + cancelled.signum
        state["status"] = "cancelled"
        if active is not None and active["status"] == "running":
            active["status"] = "cancelled"
            active["exit_code"] = exit_code
            active["elapsed_seconds"] = round(time.monotonic() - stage_started, 3)
    finally:
        save()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    print(
        f"{state['status'].upper()} {workflow} ({state['elapsed_seconds']:.2f}s); "
        f"status: {state_path}",
        flush=True,
    )
    return exit_code


def show_status(output):
    latest = output / "latest.json"
    if not latest.exists():
        print("No verification run recorded. Run cargo dev check.")
        return 1
    pointer = json.loads(latest.read_text(encoding="utf-8"))
    state = json.loads(Path(pointer["status_file"]).read_text(encoding="utf-8"))
    if state["status"] == "running":
        try:
            os.kill(state["pid"], 0)
        except ProcessLookupError:
            state["status"] = "interrupted (no completion record)"
        elapsed = datetime.now(timezone.utc) - datetime.fromisoformat(state["started_at"])
        state["elapsed_seconds"] = round(elapsed.total_seconds(), 3)
    print(json.dumps(state, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow", choices=[*WORKFLOWS, *COMMANDS, "status"])
    args = parser.parse_args()
    output = ROOT / ".verification"
    if args.workflow == "status":
        return show_status(output)
    stages = WORKFLOWS.get(args.workflow, [args.workflow])
    return run(args.workflow, stages, ROOT, output)


if __name__ == "__main__":
    sys.exit(main())
