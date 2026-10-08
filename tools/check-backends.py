#!/usr/bin/env python3
"""Verify the platform backend selection of ``scripts/notify.py``.

Every platform's *fallback chain* is exercised here by substituting the
availability checks and the senders, so the macOS and Linux behaviour is
verified from any machine and nothing is ever sent. Run through the Node test
suite (``test/notify-scripts.test.js``) or directly:

    python tools/check-backends.py
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("dsh_notify", ROOT / "scripts" / "notify.py")
notify = importlib.util.module_from_spec(SPEC)
# Register before executing: @dataclass resolves the defining module by name.
sys.modules[SPEC.name] = notify
SPEC.loader.exec_module(notify)

FAILURES: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {label}" + ("" if ok else f"   {detail}"))
    if not ok:
        FAILURES.append(label)


def main() -> int:
    print("backend order per platform")
    check("macOS", notify.backend_order("macOS", "auto") == ["notifypy", "osascript", "powershell"], notify.backend_order("macOS", "auto"))
    check("Linux", notify.backend_order("Linux", "auto") == ["notifypy", "notify-send", "powershell"], notify.backend_order("Linux", "auto"))
    check("Windows", notify.backend_order("Windows", "auto") == ["notifypy", "win11toast", "powershell"], notify.backend_order("Windows", "auto"))
    check("forced backend", notify.backend_order("macOS", "notify-send") == ["notify-send"])
    check("dry-run picks the first process backend",
          notify.planned_backend("macOS", "auto") == "osascript"
          and notify.planned_backend("Linux", "auto") == "notify-send"
          and notify.planned_backend("Windows", "auto") == "powershell")

    calls: list[tuple[str, str, str]] = []

    def record(name: str):
        def sender(item):
            calls.append((name, item.title, item.message))
        return sender

    print("fallback chains")
    notify.notifypy_available = lambda: False
    notify.osascript_available = lambda: True
    notify.osascript_send = record("osascript")
    notify.notify_send_available = lambda: True
    notify.notify_send_send = record("notify-send")
    notify.powershell_available = lambda: True
    notify.powershell_send = record("powershell")

    calls.clear()
    code = notify.main(["--platform", "macOS", "--title", "Build done", "--message", "body"])
    check("macOS without notifypy uses osascript", code == 0 and calls == [("osascript", "Build done", "body")], repr(calls))

    calls.clear()
    code = notify.main(["--platform", "Linux", "--title", "T", "--message", "M"])
    check("Linux without notifypy uses notify-send", code == 0 and calls == [("notify-send", "T", "M")], repr(calls))

    calls.clear()
    code = notify.main(["--platform", "Windows", "--title", "T", "--message", "M"])
    check("Windows without notifypy/win11toast uses the PowerShell notifier", code == 0 and calls == [("powershell", "T", "M")], repr(calls))

    calls.clear()
    notify.notifypy_available = lambda: True
    notify.notifypy_send = record("notifypy")
    code = notify.main(["--platform", "macOS", "--title", "T", "--message", "M"])
    check("notifypy always wins when present", code == 0 and calls[0][0] == "notifypy", repr(calls))

    print("failure reporting")
    notify.notifypy_available = lambda: False
    notify.osascript_available = lambda: False
    notify.notify_send_available = lambda: False
    notify.powershell_available = lambda: False
    code = notify.main(["--platform", "macOS", "--title", "T", "--message", "M"])
    check("no usable backend exits 1", code == 1)

    print("escaping")
    plan = notify.osascript_command(notify.Notification(title='say "hi"', message="C:\\tmp"))
    check("AppleScript quotes and backslashes", plan[2] == 'display notification "C:\\\\tmp" with title "say \\"hi\\""', plan[2])
    argv = notify.notify_send_command(notify.Notification(title="T", message="M", timeout=3))
    check("notify-send argv", argv[:3] == ["notify-send", "--app-name=DSH", "--expire-time=3000"] and argv[-2:] == ["T", "M"], repr(argv))

    print("")
    if FAILURES:
        print(f"{len(FAILURES)} check(s) failed: {', '.join(FAILURES)}")
        return 1
    print("All backend-selection checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
