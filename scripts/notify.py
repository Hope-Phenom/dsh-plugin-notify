#!/usr/bin/env python3
"""Desktop notification helper shipped with @hope_phenom/dsh-plugin-notify.

It tries, in order:

1. ``notifypy`` (the library the original DSH tray notification script used),
2. ``win11toast``,
3. the bundled PowerShell notifier next to this file (``notify.ps1``).

Only the standard library is required; the two optional libraries are used
when they happen to be installed, so the script works on a bare Python.

Usage
-----
    python notify.py --title "DSH" --message "hello" [--event turn-end]
    python notify.py "positional message" --title "DSH"

Unknown extra flags are ignored on purpose, so the script can also be wired
into a template that passes a wider flag set.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
POWERSHELL_SCRIPT = os.path.join(HERE, "notify.ps1")


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
    parser.add_argument("--backend", default="auto", choices=["auto", "notifypy", "win11toast", "powershell"])
    return parser


def resolve_message(args: argparse.Namespace) -> str:
    if args.message_flag:
        return str(args.message_flag)
    if args.message:
        return " ".join(str(part) for part in args.message)
    return f"{args.event} ({args.kind})"


def normalize(text: str) -> str:
    """Turn the literal ``\n`` the templates may carry into real newlines."""
    return text.replace("\\r\\n", "\n").replace("\\n", "\n").strip()


def send_notifypy(title: str, message: str, icon: str, timeout: int) -> None:
    from notifypy import Notify  # type: ignore

    notification = Notify()
    notification.title = title
    notification.message = message
    if icon and os.path.exists(icon):
        notification.icon = icon
    else:
        bundled = os.path.join(os.path.dirname(HERE), "assets", "icon.png")
        if os.path.exists(bundled):
            notification.icon = bundled
    notification.send(block=False)


def send_win11toast(title: str, message: str, icon: str, timeout: int) -> None:
    from win11toast import toast  # type: ignore

    kwargs = {"duration": "short"}
    if icon and os.path.exists(icon):
        kwargs["icon"] = {"src": icon, "placement": "appLogoOverride"}
    toast(title, message, **kwargs)


def send_powershell(title: str, message: str, icon: str, timeout: int) -> None:
    if not os.path.exists(POWERSHELL_SCRIPT):
        raise FileNotFoundError(POWERSHELL_SCRIPT)
    executable = "powershell"
    candidate = os.path.join(
        os.environ.get("SystemRoot", r"C:\Windows"),
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
    )
    if os.path.exists(candidate):
        executable = candidate
    command = [
        executable,
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        POWERSHELL_SCRIPT,
        "-Title",
        title,
        "-Message",
        message,
        "-DurationMs",
        str(max(1000, timeout * 1000)),
    ]
    if icon and os.path.exists(icon):
        command += ["-IconPath", icon]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=timeout + 20)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "powershell notifier failed").strip())


BACKENDS = {
    "notifypy": send_notifypy,
    "win11toast": send_win11toast,
    "powershell": send_powershell,
}


def main(argv: list[str]) -> int:
    args, unknown = build_parser().parse_known_args(argv)
    title = normalize(args.title) or "DSH"
    message = normalize(resolve_message(args)) or title
    order = [args.backend] if args.backend != "auto" else ["notifypy", "win11toast", "powershell"]

    failures: list[str] = []
    for backend in order:
        try:
            BACKENDS[backend](title, message, args.icon, args.timeout)
            return 0
        except Exception as error:  # noqa: BLE001 - every backend failure is reported, not raised
            failures.append(f"{backend}: {error}")

    sys.stderr.write("all notification backends failed\n" + "\n".join(failures) + "\n")
    if unknown:
        sys.stderr.write(f"ignored arguments: {' '.join(unknown)}\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
