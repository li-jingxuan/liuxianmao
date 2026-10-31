#!/usr/bin/env python3
"""Check a running proxy Socket without credentials, conversion or provider calls."""
import argparse
import html
import http.client
import json
import re
import socket

PREFIX = "/app/pindou"


class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("nas.example", timeout=15)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("socket", help="Installed target directory's pindou.sock")
    args = parser.parse_args()

    def request(path, method="GET"):
        connection = UnixHTTPConnection(args.socket)
        try:
            connection.request(method, path, headers={"X-Forwarded-Proto": "https"})
            response = connection.getresponse()
            headers = {key.lower(): value for key, value in response.getheaders()}
            return response.status, headers, response.read()
        finally:
            connection.close()

    status, _, body = request(PREFIX + "/readyz")
    assert status == 200, f"Readiness returned {status}"
    json.loads(body)
    for page in ("/", "/colors/", "/gk/fnos/", "/delivery/fnos-smoke-missing/"):
        status, _, body = request(PREFIX + page)
        assert status == 200, f"Page {page} returned {status}"
        assert b"<html" in body.lower(), f"Page {page} is not HTML"
    status, _, body = request(PREFIX + "/")
    sources = re.findall(r'(?:src|href)="([^\"]*_next/static/[^\"]+)"', body.decode())
    assert sources, "Home page has no Next.js static assets"
    assert all(source.startswith(PREFIX + "/_next/") for source in sources)
    status, _, _ = request(html.unescape(sources[0]))
    assert status == 200, f"Next.js asset returned {status}"
    status, headers, _ = request(PREFIX)
    assert status in (307, 308) and headers.get("location", "").startswith(PREFIX + "/")
    status, _, body = request(PREFIX + "/api/v1/colors")
    assert status == 200, f"Color API returned {status}"
    assert json.loads(body), "Color API returned an empty catalog"
    # Slash normalization occurs before the conversion handler. Do not follow POST.
    for method, route in (("GET", "colors"), ("POST", "conversions")):
        status, headers, _ = request(PREFIX + f"/api/v1/{route}/?probe=fnos-smoke", method)
        expected = PREFIX + f"/api/v1/{route}?probe=fnos-smoke"
        assert status == 307, f"{method} slash redirect returned {status}"
        assert headers.get("location") == expected, "Redirect lost its prefix, scheme or query"
    status, _, _ = request("/outside-pindou")
    assert status == 404, "Proxy accepted a path outside the application prefix"
    print("PASS: readiness, four pages, static assets, color API, GET/POST slash redirects, prefix boundary.")
    print("No conversion, provider request or database mutation was performed; NAS login requires a gateway check.")


if __name__ == "__main__":
    main()
