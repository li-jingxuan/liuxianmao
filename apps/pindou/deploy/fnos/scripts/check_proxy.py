"""Offline proxy scope checks, plus real nginx requests when nginx is installed."""
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time


def check_proxy(root, base, initializer):
    config = (root / "proxy/nginx.conf").read_text()
    headers = (root / "proxy/proxy-admin-headers.conf").read_text()
    # Keep these useful even on build hosts without an nginx binary.
    assert "include /etc/nginx/proxy-admin-auth.conf;" in config
    for endpoint in ("image-deliveries", "access-keys"):
        assert f"location = /app/pindou/api/v1/{endpoint} {{" in config
        assert f"location = /app/pindou/api/v1/{endpoint}/ {{" in config
        assert f"proxy_pass $api/api/v1/{endpoint}$is_args$args;" in config
    assert config.count("include /etc/nginx/proxy-admin-headers.conf;") == 2
    assert sum(line.startswith("proxy_set_header ") for line in headers.splitlines()) == 7
    assert "proxy_set_header X-Admin-API-Key $pindou_admin_api_key;" in headers
    assert "COPY proxy-admin-headers.conf" in (root / "proxy/Dockerfile").read_text()
    nginx = os.environ.get("NGINX_BINARY") or shutil.which("nginx")
    if not nginx:
        print("PASS: Exact admin routes, slash normalization, private include and shared proxy headers.")
        print("SKIP: nginx syntax and request checks (set NGINX_BINARY or install nginx).")
        return
    work = base / "nginx"
    work.mkdir()
    credential = work / "proxy-admin-auth.conf"
    # Covers config delimiters, escaped backslashes, and literal variable syntax.
    key = 'offline-$unknown-${host}-"; } # \\end'
    initializer.write_private(credential, initializer.proxy_admin_auth(key))
    records = []

    class Upstream(BaseHTTPRequestHandler):
        def handle_request(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            records.append((self.command, self.path, self.headers, body))
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(b"OK")

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = handle_request

        def log_message(self, *args):
            pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    # A short Unix path also works on macOS, whose sun_path limit is 104 bytes.
    import tempfile
    with tempfile.TemporaryDirectory(prefix="pd-nginx-", dir="/tmp") as socket_dir:
        gateway = Path(socket_dir) / "gateway.sock"
        rendered = config.replace("user nginx;", "")
        rendered = rendered.replace("pid /tmp/nginx.pid;", f"pid {work}/nginx.pid;")
        rendered = rendered.replace("include /etc/nginx/mime.types;", "")
        rendered = rendered.replace("/etc/nginx/proxy-admin-auth.conf", str(credential))
        rendered = rendered.replace("/etc/nginx/proxy-admin-headers.conf", str(root / "proxy/proxy-admin-headers.conf"))
        rendered = rendered.replace("/gateway/pindou.sock", str(gateway))
        rendered = rendered.replace("/dev/stdout safe;", "/dev/null safe;")
        rendered = rendered.replace("resolver 127.0.0.11", "resolver 127.0.0.1")
        for name in ("api", "web"):
            rendered = rendered.replace(f"http://{name}:" + ("3112" if name == "api" else "3111"),
                                        f"http://127.0.0.1:{upstream.server_port}")
        for name in ("client_body", "proxy", "fastcgi", "uwsgi", "scgi"):
            rendered = rendered.replace(f"/tmp/{name};", f"{work}/{name};")
        configuration = work / "nginx.conf"
        configuration.write_text(rendered)
        command = [nginx, "-p", str(work), "-c", str(configuration)]
        process = None
        try:
            result = subprocess.run(command + ["-t"], capture_output=True)
            assert result.returncode == 0, "nginx syntax validation failed (diagnostics withheld)"
            process = subprocess.Popen(command + ["-g", "daemon off;"], stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL)
            for _ in range(100):
                if gateway.exists():
                    break
                assert process.poll() is None, "nginx exited before socket creation"
                time.sleep(0.02)
            assert gateway.exists(), "nginx socket was not created"

            def request(method, path, client_key, upgrade=False):
                connection = HTTPConnection("nas.example", timeout=5)
                connection.sock = socket.socket(socket.AF_UNIX)
                connection.sock.settimeout(5)
                connection.sock.connect(str(gateway))
                request_headers = {"Host": "nas.example", "X-Forwarded-Proto": "https",
                                   "X-Forwarded-For": "198.51.100.2", "X-API-Key": "conversion-fixture"}
                if client_key is not None:
                    request_headers["X-Admin-API-Key"] = client_key
                if upgrade:
                    request_headers["Upgrade"] = "websocket"
                body = b"offline-test-body" if method == "POST" else None
                count = len(records)
                try:
                    connection.request(method, path, body=body, headers=request_headers)
                    response = connection.getresponse()
                    assert response.status == 200, "Unexpected proxy response"
                    assert key.encode() not in response.read(), "Credential leaked in response"
                finally:
                    connection.close()
                assert len(records) == count + 1
                seen_method, seen_path, seen_headers, seen_body = records[-1]
                assert seen_method == method
                assert seen_headers["Host"] == "nas.example"
                assert seen_headers["X-Forwarded-Host"] == "nas.example"
                assert seen_headers["X-Forwarded-Proto"] == "https"
                assert seen_headers["X-Forwarded-For"].startswith("198.51.100.2")
                assert seen_headers["X-API-Key"] == "conversion-fixture"
                assert seen_headers["Connection"] == ("upgrade" if upgrade else "close")
                assert seen_headers.get("Upgrade") == ("websocket" if upgrade else None)
                if body:
                    assert seen_body == body
                return seen_path, seen_headers.get("X-Admin-API-Key")

            for endpoint in ("image-deliveries", "access-keys"):
                for slash in ("", "/"):
                    for method in ("POST", "GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"):
                        for client_key in (None, "forged-admin"):
                            seen_path, seen_key = request(method, f"/app/pindou/api/v1/{endpoint}{slash}?fixture=1", client_key)
                            assert seen_path == f"/api/v1/{endpoint}?fixture=1"
                            assert seen_key == (key if method == "POST" else client_key), "Admin credential scope mismatch"
            request("POST", "/app/pindou/api/v1/access-keys", "forged-admin", upgrade=True)
            for path in ("access-keys/quota", "access-keys/quota/", "access-keys-other", "source-prefixes",
                         "image-deliveries/example", "image-deliveries-other", "conversions"):
                for client_key in (None, "forged-admin"):
                    seen_path, seen_key = request("POST", f"/app/pindou/api/v1/{path}?fixture=1", client_key)
                    assert seen_path == f"/api/v1/{path}?fixture=1"
                    assert seen_key == client_key, "Admin credential escaped exact endpoints"
            # The required include fails closed instead of enabling a proxy without auth.
            credential.unlink()
            assert subprocess.run(command + ["-t"], capture_output=True).returncode != 0
            print("PASS: nginx -t, literal secret escaping, POST-only exact admin scope, slash/query/body preservation,")
            print("      client header override, quota isolation, forwarded headers and missing credential rejection.")
        finally:
            if process is not None:
                process.terminate()
                process.wait(timeout=10)
            upstream.shutdown()
            upstream.server_close()
            thread.join(timeout=5)
