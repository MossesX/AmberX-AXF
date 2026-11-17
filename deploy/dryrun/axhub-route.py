"""A stand-in for axHub's downstream route in the console-down drill: POST /mcp is forwarded to axf-data's /mcp with
the hub's service token, nothing is stored (route only, like deploy/axhub/axf-data.downstream.json). Stdlib only."""
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

UPSTREAM = os.environ.get("AXF_DATA_URL", "http://axf-data:7700").rstrip("/") + "/mcp"
TOKEN = os.environ.get("AXF_DATA_TOKEN", "")


class Route(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        req = urllib.request.Request(UPSTREAM, data=body, method="POST", headers={"content-type": "application/json", "authorization": f"Bearer {TOKEN}"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                status, data = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, data = e.code, e.read()
        except OSError as e:
            status, data = 502, str(e).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


HTTPServer(("0.0.0.0", 8080), Route).serve_forever()
