"""Serve the explorer with byte ranges for PMTiles and Parquet, and a /catalog mount.

Usage: pixi run serve [--catalog-dir DIR ...]

Requests under /catalog/ are answered from the given directories. The first
directory that holds the file wins, so a catalog tree and a staging tree of
data files can stand in for one published catalog. Open
http://localhost:8000/?catalog=catalog/catalog.json to read from the mount.
"""

from __future__ import annotations

import argparse
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re
import sys
from typing import IO
from urllib.parse import unquote

RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
MOUNT = "/catalog/"
# Reload page code and JSON; allow normal caching for tiles and archives.
NO_STORE_SUFFIXES = frozenset({"", ".html", ".js", ".mjs", ".css", ".json"})


class RangeRequestHandler(SimpleHTTPRequestHandler):
    """Static handler that honors single-range ``Range`` requests."""

    # Reuse connections across tile requests.
    protocol_version = "HTTP/1.1"

    # mimetypes lacks the web app manifest type.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
    }

    catalog_dirs: tuple[Path, ...] = ()

    @staticmethod
    def _request_path(path: str) -> str:
        """The path component of a request line, without the query or fragment."""
        return path.split("?", 1)[0].split("#", 1)[0]

    def _is_catalog(self, clean: str) -> bool:
        return clean.startswith(MOUNT)

    def _catalog_target(self, clean: str) -> Path | None:
        """Resolve a /catalog path in the first directory that holds it.

        Returns None when the path escapes every directory, including through a
        symlink. A path no directory holds resolves in the first one, so the
        usual 404 follows.
        """
        name = unquote(clean.removeprefix(MOUNT)).lstrip("/")
        first: Path | None = None
        for directory in self.catalog_dirs:
            target = (directory / name).resolve()
            if not target.is_relative_to(directory):
                return None
            if target.is_file():
                return target
            first = first or target
        return first

    def translate_path(self, path: str) -> str:
        """Map ``/catalog/...`` onto the mounted directories, the rest onto the web root."""
        clean = self._request_path(path)
        if self._is_catalog(clean):
            target = self._catalog_target(clean)
            # Keep direct callers contained too; send_head rejects escaping paths.
            if target is not None:
                return str(target)
            return str(self.catalog_dirs[0] if self.catalog_dirs else Path(os.devnull))
        return super().translate_path(path)

    def send_head(self) -> _Slice | IO[bytes] | None:
        """Answer a byte-range request, falling back to the full-body handler."""
        clean = self._request_path(self.path)
        if self._is_catalog(clean) and (
            not self.catalog_dirs or self._catalog_target(clean) is None
        ):
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        header = self.headers.get("Range")
        match = RANGE_RE.match(header) if header else None
        # Ignore malformed ranges, including bytes=- with neither endpoint.
        if match is None or not (match.group(1) or match.group(2)):
            return super().send_head()

        path = self.translate_path(self.path)
        try:
            handle = Path(path).open("rb")  # noqa: SIM115
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        size = os.fstat(handle.fileno()).st_size
        first, last = match.group(1), match.group(2)
        if first:
            start = int(first)
            end = int(last) if last else size - 1
        else:
            # A suffix range ("bytes=-500") asks for the final N bytes.
            start, end = max(0, size - int(last)), size - 1
        if start >= size or start > end:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            handle.close()
            return None

        end = min(end, size - 1)
        handle.seek(start)
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        # SimpleHTTPRequestHandler copies to the end of the file, so hand it
        # only the requested slice.
        return _Slice(handle, end - start + 1)

    def end_headers(self) -> None:
        """Advertise byte ranges and prevent stale page code and JSON on reload."""
        self.send_header("Accept-Ranges", "bytes")
        suffix = Path(self.path.split("?", 1)[0]).suffix
        if suffix in NO_STORE_SUFFIXES:
            self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class _Slice:
    """Read-only view of the first ``length`` bytes from the current file offset."""

    def __init__(self, handle: IO[bytes], length: int) -> None:
        self._handle = handle
        self._remaining = length

    def read(self, size: int = -1) -> bytes:
        if self._remaining <= 0:
            return b""
        want = self._remaining if size < 0 else min(size, self._remaining)
        chunk = self._handle.read(want)
        self._remaining -= len(chunk)
        return chunk

    def close(self) -> None:
        self._handle.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web-dir", default=".", help="directory holding index.html")
    parser.add_argument(
        "--catalog-dir",
        action="append",
        default=[],
        help="directory to mount under /catalog; repeat it to search several in order",
    )
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()

    web_dir = Path(args.web_dir).resolve()
    catalog_dirs = tuple(Path(directory).resolve() for directory in args.catalog_dir)
    if not (web_dir / "index.html").is_file():
        sys.exit(f"No index.html in {web_dir}")
    for directory in catalog_dirs:
        if not directory.is_dir():
            sys.exit(f"No catalog directory {directory}")

    handler = partial(RangeRequestHandler, directory=str(web_dir))
    RangeRequestHandler.catalog_dirs = catalog_dirs
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        host = "localhost" if args.bind == "127.0.0.1" else args.bind
        mounted = ", ".join(str(directory) for directory in catalog_dirs) or "none"
        print(f"Serving {web_dir} (catalog: {mounted}) on http://{host}:{args.port}/")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
