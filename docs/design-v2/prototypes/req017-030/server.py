"""Serve the independent review prototype; never imports or mutates product code."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


class PrototypeHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if parsed.path == "/":
            self.path = "/index.html"
        elif parsed.path.rstrip("/") == "/editor":
            self.path = "/editor.html" if parse_qs(parsed.query).get("view") == ["range"] else "/chords.html"
        elif parsed.path.rstrip("/") == "/guitar-advanced":
            self.path = "/advanced.html"
        return super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4180)
    args = parser.parse_args()
    root = str(Path(__file__).resolve().parent)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(PrototypeHandler, directory=root))
    print(f"Prototype: http://127.0.0.1:{args.port}/", flush=True)
    server.serve_forever()
