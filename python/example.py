"""Copy-ready examples for the NovaTube Python wrapper.

Run a single example:

    python python/example.py search
    python python/example.py info
    python python/example.py download
    python python/example.py batch

Downloads go to ``downloads/`` next to this file. Pass a different folder with
``--output-dir``. The examples use public videos that are safe to re-download,
so running them twice is fine (add ``resume=True`` to skip finished files).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from novatube_cli import NovatubeCLI, NovatubeError, stream_events

# A 19 second video keeps the download example quick. Swap in your own link.
SHORT_VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
MUSIC_VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

OUTPUT_DIR = Path(__file__).resolve().parent / "downloads"


def _make_console_forgiving() -> None:
    """Windows terminals often use a legacy code page (cp1250, cp437, ...).

    Video titles contain emoji, so replace anything the console cannot encode
    instead of crashing the example.
    """
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(errors="replace")
            except (ValueError, OSError):
                pass


def example_search(cli: NovatubeCLI) -> None:
    """Search YouTube and print the first results."""
    print("Searching for 'lofi hip hop'...\n")
    entries = cli.search("lofi hip hop", limit=5)
    for entry in entries:
        duration = entry.get("duration_string") or "live"
        uploader = entry.get("uploader") or "unknown"
        print(f"{entry['index']:>2}. {entry['title']}")
        print(f"    {uploader} | {duration} | https://youtu.be/{entry['id']}")


def example_info(cli: NovatubeCLI) -> None:
    """Read metadata without downloading anything."""
    info = cli.info(MUSIC_VIDEO)
    print(f"Title:      {info['title']}")
    print(f"Channel:    {info.get('channel') or info.get('uploader') or 'unknown'}")
    print(f"Duration:   {info.get('duration_string') or 'unknown'}")
    print(f"Views:      {info.get('view_count', 0):,}")
    print(f"Uploaded:   {info.get('upload_date') or 'unknown'}")
    print(f"Thumbnail:  {info.get('thumbnail') or 'unknown'}")
    qualities = ", ".join(f"{height}p" for height in info.get("qualities", []))
    if qualities:
        print(f"Qualities:  {qualities}")


def example_download(cli: NovatubeCLI, output_dir: Path) -> None:
    """Download one video with a custom name and live progress."""

    def on_event(event: dict) -> None:
        kind = event.get("type")
        if kind == "progress":
            # A raw \r line so the terminal shows a single updating bar.
            print(
                f"\r  {event['stage']:<12} {event['percent']:5.1f}%"
                f"  {event.get('speed') or ''}  ETA {event.get('eta') or '--'}   ",
                end="",
                flush=True,
            )
        elif kind == "item_done":
            size = event.get("file_size") or 0
            print(f"\n  saved: {event['output_path']} ({size / 1_048_576:.1f} MB)")
        elif kind == "error":
            print(f"\n  error: {event['message']}", file=sys.stderr)

    print(f"Downloading {SHORT_VIDEO} as 'Example Clip'...")
    report = cli.download(
        SHORT_VIDEO,
        name="Example Clip",  # the real extension is appended automatically
        fmt="mp4",
        quality="360",
        compress="none",  # keep the example fast; try "balanced" for smaller files
        output_dir=output_dir,
        on_event=on_event,
    )
    print("ok" if report["ok"] else "some items failed")


def example_batch(cli: NovatubeCLI, output_dir: Path) -> None:
    """Download several URLs at once, giving each its own name."""
    urls = [SHORT_VIDEO, MUSIC_VIDEO]
    names = ["Zoo Clip", "Never Gonna Give You Up"]  # mapped by index

    print(f"Batch downloading {len(urls)} items...")
    seen: set[str] = set()
    for event in stream_events(
        urls,
        cli=cli,
        names=names,
        fmt="mp3",
        quality="bestaudio",
        output_dir=output_dir,
        concurrency=2,
        resume=True,
    ):
        kind = event.get("type")
        if kind == "start":
            print(f"  queued [{event['index']}/{event['total']}] {event['title']}")
        elif kind == "item_done":
            state = "skipped" if event.get("skipped") else "downloaded"
            print(f"  {state}: {event['output_path']}")
        elif kind == "error":
            print(f"  error: {event['message']}", file=sys.stderr)
        elif kind == "done":
            for result in event.get("results", []):
                seen.add(result["status"])
            print(f"  finished with statuses: {', '.join(sorted(seen)) or 'none'}")


EXAMPLES = {
    "search": example_search,
    "info": example_info,
    "download": example_download,
    "batch": example_batch,
}


def main() -> int:
    _make_console_forgiving()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("example", choices=sorted(EXAMPLES), nargs="?", default="search")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help="destination folder for downloads",
    )
    arguments = parser.parse_args()

    try:
        cli = NovatubeCLI()
    except NovatubeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    example = EXAMPLES[arguments.example]
    try:
        if arguments.example in {"download", "batch"}:
            example(cli, arguments.output_dir)
        else:
            example(cli)
    except NovatubeError as error:
        print(f"error: {error}", file=sys.stderr)
        return error.returncode or 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
