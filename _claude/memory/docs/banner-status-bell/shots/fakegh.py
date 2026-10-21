import json, sys, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
now = datetime.datetime.now(datetime.timezone.utc)
iso = lambda m: (now - datetime.timedelta(minutes=m)).strftime('%Y-%m-%dT%H:%M:%SZ')
RUN = {"id": 42, "name": "Android framework + console", "display_title": "Alerts bell + main build status on the banner", "head_sha": "9f3c2a1b7e", "run_number": 812, "event": "push", "status": "completed", "conclusion": "success", "html_url": "https://github.com/MossesX/AmberX-AXF/actions/runs/42", "run_started_at": iso(14), "created_at": iso(14), "updated_at": iso(2)}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        b = json.dumps({"workflow_runs": [RUN], "jobs": []}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
