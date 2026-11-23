"""Thin Python wrapper around NovaTube's headless CLI.

NovaTube itself is a desktop app, but the same executable doubles as a CLI:

    novatube search "lofi hip hop" --limit 5 --json
    novatube info  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --json
    novatube download "https://youtu.be/dQw4w9WgXcQ" --name "Song" --stream

This module wraps those calls with subprocess so a script can search, inspect
and download without knowing the command line layout. Downloads are read as
NDJSON through `subprocess.Popen`, which means progress arrives live instead of
all at once when the process exits.

The executable is found in this order:

1. ``NOVATUBE_BIN`` environment variable (full path to the executable).
2. ``novatube`` / ``novatube.exe`` on ``PATH``.
3. Typical development and install locations relative to this file.

Usage::

    from novatube_cli import NovatubeCLI

    cli = NovatubeCLI()
    results = cli.search("lofi hip hop", limit=3)
    print(results[0]["title"])

No third-party packages are required.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator, Sequence

IS_WINDOWS = os.name == "nt"
EXE_NAME = "novatube.exe" if IS_WINDOWS else "novatube"

EventCallback = Callable[[dict[str, Any]], None]


class NovatubeError(RuntimeError):
    """Raised when the CLI exits with a non-zero status."""

    def __init__(self, message: str, returncode: int = -1, stderr: str = "") -> None:
        super().__init__(message)
        self.returncode = returncode
        self.stderr = stderr


def find_binary() -> str:
    """Return the path to the NovaTube executable."""
    override = os.environ.get("NOVATUBE_BIN")
    if override:
        path = Path(override).expanduser()
        if path.is_file():
            return str(path)
        raise NovatubeError(f"NOVATUBE_BIN points at {path}, which does not exist.")

    on_path = shutil.which("novatube")
    if on_path:
        return on_path

    here = Path(__file__).resolve().parent
    candidates = [
        here / EXE_NAME,
        here.parent / EXE_NAME,
        here.parent / "src-tauri" / "target" / "release" / EXE_NAME,
        here.parent / "src-tauri" / "target" / "debug" / EXE_NAME,
    ]
    # Tauri's NSIS installer defaults to %LOCALAPPDATA%\<productName>.
    for variable, suffix in (
        ("LOCALAPPDATA", ("NovaTube", EXE_NAME)),
        ("LOCALAPPDATA", ("Programs", "NovaTube", EXE_NAME)),
        ("PROGRAMFILES", ("NovaTube", EXE_NAME)),
    ):
        base = os.environ.get(variable)
        if base:
            candidates.append(Path(base).joinpath(*suffix))
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)

    raise NovatubeError(
        "Could not find the NovaTube executable. Add it to PATH, set NOVATUBE_BIN, "
        "or place novatube next to this file."
    )


class NovatubeCLI:
    """Convenience wrapper around the NovaTube command line."""

    def __init__(self, binary: str | None = None) -> None:
        self.binary = binary or find_binary()

    # ------------------------------------------------------------------ info
    def info(self, url: str, timeout: float = 240.0) -> dict[str, Any]:
        """Metadata for a video or playlist (never downloads media)."""
        stdout = self._run_json(["info", url, "--json"], timeout=timeout)
        return json.loads(stdout)

    def search(
        self,
        query: str,
        limit: int = 5,
        timeout: float = 180.0,
    ) -> list[dict[str, Any]]:
        """Search YouTube and return a list of entries."""
        stdout = self._run_json(
            ["search", query, "--limit", str(limit), "--json"], timeout=timeout
        )
        return json.loads(stdout).get("entries", [])

    # -------------------------------------------------------------- download
    def download(
        self,
        urls: str | Sequence[str],
        *,
        name: str | None = None,
        names: Sequence[str] | None = None,
        name_template: str | None = None,
        fmt: str | None = None,
        quality: str | None = None,
        compress: str | None = None,
        output_dir: str | os.PathLike[str] | None = None,
        subtitles: str | bool | None = None,
        sponsorblock: bool = False,
        concurrency: int | None = None,
        resume: bool = False,
        dry_run: bool = False,
        on_event: EventCallback | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Download one or more URLs, streaming events to ``on_event``.

        Returns the final ``done`` payload with the shape::

            {"ok": bool, "returncode": int, "results": [...]}

        Every event is also passed to ``on_event`` (``start``, ``progress``,
        ``item_done``, ``error`` and ``done``).
        """
        if isinstance(urls, str):
            urls = [urls]
        if not urls:
            raise ValueError("At least one URL is required.")

        command = ["download", *urls]
        if name:
            command += ["--name", name]
        if names:
            # A JSON array is passed verbatim, so names may contain commas.
            command += ["--names", json.dumps(list(names))]
        if name_template:
            command += ["--name-template", name_template]
        if fmt:
            command += ["--format", fmt]
        if quality:
            command += ["--quality", quality]
        if compress:
            command += ["--compress", compress]
        if output_dir:
            command += ["--output-dir", str(output_dir)]
        if subtitles is True:
            command += ["--subtitles"]
        elif isinstance(subtitles, str) and subtitles.lower() != "off":
            command += ["--subtitles", subtitles]
        if sponsorblock:
            command.append("--sponsorblock")
        if concurrency:
            command += ["--concurrency", str(concurrency)]
        if resume:
            command.append("--resume")
        if dry_run:
            command.append("--dry-run")
        command.append("--stream")

        return self._run_stream(command, on_event=on_event, timeout=timeout)

    def download_many(self, urls: Sequence[str], **kwargs: Any) -> dict[str, Any]:
        """Alias for :meth:`download` that makes batch intent explicit."""
        return self.download(list(urls), **kwargs)

    # ------------------------------------------------------------- internals
    def _command(self) -> list[str]:
        return [self.binary]

    def _run_json(self, arguments: Sequence[str], timeout: float | None) -> str:
        completed = subprocess.run(
            self._command() + list(arguments),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        if completed.returncode != 0:
            raise NovatubeError(
                (completed.stderr or "").strip() or "NovaTube failed.",
                returncode=completed.returncode,
                stderr=completed.stderr,
            )
        return completed.stdout

    def _run_stream(
        self,
        arguments: Sequence[str],
        *,
        on_event: EventCallback | None,
        timeout: float | None,
    ) -> dict[str, Any]:
        process = subprocess.Popen(
            self._command() + list(arguments),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        assert process.stdout is not None
        assert process.stderr is not None

        stderr_chunks: list[str] = []

        def drain_stderr() -> None:
            # Keep the stderr pipe empty so a chatty error cannot deadlock the
            # process while we are reading stdout.
            for line in process.stderr:
                stderr_chunks.append(line)

        stderr_thread = threading.Thread(target=drain_stderr, daemon=True)
        stderr_thread.start()

        results: list[dict[str, Any]] = []
        ok = True
        try:
            for line in process.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    # Never crash on an unexpected line; hand it over verbatim.
                    event = {"type": "raw", "line": line}
                if event.get("type") == "done":
                    results = event.get("results", [])
                if event.get("type") == "error":
                    ok = False
                if on_event is not None:
                    on_event(event)
        finally:
            returncode = process.wait(timeout=timeout)
            stderr_thread.join(timeout=5)

        stderr = "".join(stderr_chunks)
        if returncode != 0:
            if not results:
                raise NovatubeError(
                    stderr.strip() or f"NovaTube exited with status {returncode}.",
                    returncode=returncode,
                    stderr=stderr,
                )
            ok = False

        return {"ok": ok, "returncode": returncode, "results": results}


def stream_events(
    urls: str | Sequence[str], cli: NovatubeCLI | None = None, **kwargs: Any
) -> Iterator[dict[str, Any]]:
    """Generator form of :meth:`NovatubeCLI.download` for ``for event in ...``."""
    cli = cli or NovatubeCLI()
    yield from _iter_events(cli, urls, dict(kwargs))


def _iter_events(
    cli: NovatubeCLI, urls: str | Sequence[str], kwargs: dict[str, Any]
) -> Iterator[dict[str, Any]]:
    if isinstance(urls, str):
        urls = [urls]
    command = ["download", *urls]
    option_map = {
        "name": "--name",
        "name_template": "--name-template",
        "fmt": "--format",
        "quality": "--quality",
        "compress": "--compress",
        "output_dir": "--output-dir",
    }
    for key, flag in option_map.items():
        value = kwargs.get(key)
        if value:
            command += [flag, str(value)]
    names = kwargs.get("names")
    if names:
        # A JSON array is passed verbatim, so names may contain commas.
        command += ["--names", json.dumps(list(names))]
    subtitles = kwargs.get("subtitles")
    if subtitles is True:
        command.append("--subtitles")
    elif isinstance(subtitles, str) and subtitles.lower() != "off":
        command += ["--subtitles", subtitles]
    if kwargs.get("sponsorblock"):
        command.append("--sponsorblock")
    if kwargs.get("concurrency"):
        command += ["--concurrency", str(kwargs["concurrency"])]
    if kwargs.get("resume"):
        command.append("--resume")
    if kwargs.get("dry_run"):
        command.append("--dry-run")
    command.append("--stream")

    process = subprocess.Popen(
        [cli.binary] + command,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            yield {"type": "raw", "line": line}
    process.wait()


def _make_console_forgiving() -> None:
    """Let Windows legacy code pages print emoji-laden titles without crashing."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(errors="replace")
            except (ValueError, OSError):
                pass


def _format_size(size: int | None) -> str:
    if not size:
        return "?"
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{size} B"


def main(argv: Iterable[str] | None = None) -> int:
    """Tiny self-test entry point: ``python novatube_cli.py search <query>``."""
    _make_console_forgiving()
    arguments = list(sys.argv[1:] if argv is None else argv)
    if not arguments or arguments[0] in {"-h", "--help"}:
        print(__doc__)
        return 0

    cli = NovatubeCLI()
    command, rest = arguments[0], arguments[1:]
    try:
        if command == "search":
            query = " ".join(rest) or "lofi hip hop"
            for entry in cli.search(query, limit=5):
                print(f"{entry['id']}  {entry['title']}")
        elif command == "info":
            print(json.dumps(cli.info(rest[0]), indent=2, ensure_ascii=False))
        elif command == "download":
            if not rest:
                print("usage: novatube_cli.py download URL [URL ...]", file=sys.stderr)
                return 2

            def show(event: dict[str, Any]) -> None:
                if event.get("type") == "progress":
                    print(
                        f"\r[{event['index']}] {event['stage']} "
                        f"{event['percent']:.1f}%",
                        end="",
                        flush=True,
                    )
                elif event.get("type") == "item_done":
                    print(f"\n{event['output_path']} ({_format_size(event.get('file_size'))})")
                elif event.get("type") == "error":
                    print(f"\nerror: {event['message']}", file=sys.stderr)

            report = cli.download(rest, on_event=show)
            return 0 if report["ok"] else 1
        else:
            print(f"unknown command: {command}", file=sys.stderr)
            return 2
    except NovatubeError as error:
        print(f"error: {error}", file=sys.stderr)
        return error.returncode or 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
