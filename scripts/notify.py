#!/usr/bin/env python3
"""Desktop notification helper shipped with @hope_phenom/dsh-plugin-notify.

Backends, in the order each platform prefers them:

* ``notifypy``    - the library the original DSH tray script used. It ships its
                    own notifier for Windows, macOS (a bundled ``Notificator.app``)
                    and Linux, so it stays first wherever it is installed.
* ``win11toast``  - Windows only, used when it happens to be installed.
* ``osascript``   - macOS, via ``display notification``.
* ``notify-send`` - Linux, via the freedesktop notifier.
* ``powershell``  - runs the sibling ``notify.ps1``; on Windows that is the
                    WinForms/WinRT notifier, elsewhere it forwards to the
                    platform's native tool. Needs ``pwsh``.

Only the standard library is required: every other backend is optional and is
skipped when it is missing, so the script also works on a bare Python.

Usage
-----
    python notify.py --title "DSH" --message "hello" [--event turn-end]
    python notify.py "positional message" --title "DSH"

Diagnostics (nothing is sent, the resolved command is printed as JSON):

    python notify.py --dry-run --platform macOS --title T --message M
    python notify.py --dry-run --backend notify-send --title T --message M

Unknown extra flags are ignored on purpose, so the script can be wired into a
template that passes a wider flag set.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform as platform_module
import shutil
import subprocess
import sys
from dataclasses import dataclass

HERE = os.path.dirname(os.path.abspath(__file__))
POWERSHELL_SCRIPT = os.path.join(HERE, "notify.ps1")

#: Logical platform name -> `platform.system()` value.
PLATFORMS = {"Windows": "Windows", "macOS": "Darwin", "Linux": "Linux"}

#: Backends tried, in order, per logical platform.
DEFAULT_ORDER = {
    "Windows": ["notifypy", "win11toast", "powershell"],
    "macOS": ["notifypy", "osascript", "powershell"],
    "Linux": ["notifypy", "notify-send", "powershell"],
}

ALL_BACKENDS = ["notifypy", "win11toast", "notify-send", "osascript", "powershell"]


@dataclass
class Notification:
    """One notification, already resolved into title and body."""

    title: str
    message: str
    icon: str = ""
    timeout: int = 6


def current_platform() -> str:
    system = platform_module.system()
    for logical, value in PLATFORMS.items():
        if value == system:
            return logical
    return "Linux"


def has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


# --------------------------------------------------------------------------- #
# Backends
# --------------------------------------------------------------------------- #


def notifypy_available() -> bool:
    return has_module("notifypy")


def notifypy_send(item: Notification) -> None:
    from notifypy import Notify  # type: ignore

    notification = Notify()
    notification.title = item.title
    notification.message = item.message
    icon = item.icon or os.path.join(os.path.dirname(HERE), "assets", "icon.png")
    if icon and os.path.exists(icon):
        notification.icon = icon
    # The macOS and Linux notifiers run as a short-lived child process, so a
    # non-blocking send can return before the notification has been posted.
    notification.send(block=current_platform() != "Windows")


def win11toast_available() -> bool:
    return has_module("win11toast")


def win11toast_send(item: Notification) -> None:
    from win11toast import toast  # type: ignore

    kwargs = {"duration": "short"}
    if item.icon and os.path.exists(item.icon):
        kwargs["icon"] = {"src": item.icon, "placement": "appLogoOverride"}
    toast(item.title, item.message, **kwargs)


def applescript_string(value: str) -> str:
    """Escape text for an AppleScript string literal."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def osascript_command(item: Notification) -> list[str]:
    script = 'display notification "{}" with title "{}"'.format(
        applescript_string(item.message),
        applescript_string(item.title),
    )
    return ["osascript", "-e", script]


def osascript_available() -> bool:
    return shutil.which("osascript") is not None


def osascript_send(item: Notification) -> None:
    completed = subprocess.run(osascript_command(item), capture_output=True, text=True, timeout=item.timeout + 20)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "osascript failed").strip())


def notify_send_command(item: Notification) -> list[str]:
    return [
        "notify-send",
        "--app-name=DSH",
        "--expire-time={}".format(max(1000, item.timeout * 1000)),
        item.title,
        item.message,
    ]


def notify_send_available() -> bool:
    return shutil.which("notify-send") is not None


def notify_send_send(item: Notification) -> None:
    completed = subprocess.run(notify_send_command(item), capture_output=True, text=True, timeout=item.timeout + 20)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "notify-send failed").strip())


def powershell_executable() -> str:
    """Prefer `pwsh` everywhere; fall back to Windows PowerShell on Windows."""
    found = shutil.which("pwsh") or shutil.which("powershell")
    if found:
        return found
    candidate = os.path.join(
        os.environ.get("SystemRoot", r"C:\Windows"),
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
    )
    return candidate if os.path.exists(candidate) else ""


def powershell_command(item: Notification) -> list[str]:
    executable = powershell_executable() or "pwsh"
    command = [
        executable,
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        POWERSHELL_SCRIPT,
        "-Title",
        item.title,
        "-Message",
        item.message,
        "-DurationMs",
        str(max(1000, item.timeout * 1000)),
    ]
    if item.icon and os.path.exists(item.icon):
        command += ["-IconPath", item.icon]
    return command


def powershell_available() -> bool:
    return os.path.exists(POWERSHELL_SCRIPT) and powershell_executable() != ""


def powershell_send(item: Notification) -> None:
    completed = subprocess.run(powershell_command(item), capture_output=True, text=True, timeout=item.timeout + 30)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "powershell notifier failed").strip())


def backends() -> dict:
    """Backends by name: (availability check, sender, command builder or None).

    Built on every call so that a missing library or tool is re-checked, and so
    that the platform branches can be exercised by substituting these functions.
    """
    return {
        "notifypy": (notifypy_available, notifypy_send, None),
        "win11toast": (win11toast_available, win11toast_send, None),
        "osascript": (osascript_available, osascript_send, osascript_command),
        "notify-send": (notify_send_available, notify_send_send, notify_send_command),
        "powershell": (powershell_available, powershell_send, powershell_command),
    }


# --------------------------------------------------------------------------- #
# Command line
# --------------------------------------------------------------------------- #


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Send a desktop notification.")
    parser.add_argument("message", nargs="*", help="Notification body (positional form)")
    parser.add_argument("--title", default="DSH", help="Notification title")
    parser.add_argument("--message", dest="message_flag", default=None, help="Notification body")
    parser.add_argument("--event", default="turn-end", help="Event name, e.g. turn-end")
    parser.add_argument("--kind", default="root", help="root or subagent")
    parser.add_argument("--session", default="", help="Session id")
    parser.add_argument("--turn", default="", help="Turn number")
    parser.add_argument("--reason", default="", help="Turn end reason")
    parser.add_argument("--duration-ms", dest="duration_ms", default="", help="Turn duration in ms")
    parser.add_argument("--icon", default="", help="Path to a .png/.ico icon")
    parser.add_argument("--timeout", type=int, default=6, help="Seconds the notification should linger")
    parser.add_argument(
        "--backend",
        default="auto",
        choices=["auto", *ALL_BACKENDS],
        help="Force one backend instead of the platform's order",
    )
    parser.add_argument(
        "--platform",
        default="auto",
        choices=["auto", *PLATFORMS],
        help="Assume this platform instead of detecting it (diagnostics)",
    )
    parser.add_argument("--dry-run", dest="dry_run", action="store_true", help="Print the resolved command and exit")
    return parser


def resolve_message(args: argparse.Namespace) -> str:
    if args.message_flag:
        return str(args.message_flag)
    if args.message:
        return " ".join(str(part) for part in args.message)
    return f"{args.event} ({args.kind})"


def normalize(text: str) -> str:
    """Turn the literal ``\\n`` a template may carry into real newlines."""
    return text.replace("\\r\\n", "\n").replace("\\n", "\n").strip()


def build_item(args: argparse.Namespace) -> Notification:
    title = normalize(args.title) or "DSH"
    message = normalize(resolve_message(args)) or title
    return Notification(title=title, message=message, icon=args.icon, timeout=max(1, args.timeout))


def backend_order(target: str, requested: str) -> list[str]:
    """The backends to try, in order, for one target platform."""
    if requested != "auto":
        return [requested]
    return list(DEFAULT_ORDER.get(target, DEFAULT_ORDER["Linux"]))


def planned_backend(target: str, requested: str) -> str:
    """The backend `--dry-run` reports for a target platform."""
    for backend in backend_order(target, requested):
        if backends()[backend][2] is not None:
            return backend
    return backend_order(target, requested)[0]


def describe(target: str, backend: str, item: Notification, dry_run: bool) -> dict:
    available_fn, _, command_fn = backends()[backend]
    available = bool(available_fn())
    if command_fn is not None:
        command = command_fn(item)
    else:
        command = ["<library>", f"title={item.title}", f"message={item.message}"]
    return {
        "platform": target,
        "backend": backend,
        "available": available,
        "command": command,
        "title": item.title,
        "message": item.message,
        "dryRun": dry_run,
    }


def main(argv: list[str]) -> int:
    args = build_parser().parse_known_args(argv)[0]
    item = build_item(args)
    target = args.platform if args.platform != "auto" else current_platform()

    if args.dry_run:
        backend = planned_backend(target, args.backend)
        print(json.dumps(describe(target, backend, item, True), ensure_ascii=False))
        return 0

    failures: list[str] = []
    for backend in backend_order(target, args.backend):
        available_fn, send_fn, _ = backends()[backend]
        try:
            if not available_fn():
                failures.append(f"{backend}: not available")
                continue
            send_fn(item)
            return 0
        except Exception as error:  # noqa: BLE001 - every backend failure is reported, not raised
            failures.append(f"{backend}: {error}")

    sys.stderr.write("all notification backends failed\n" + "\n".join(failures) + "\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
