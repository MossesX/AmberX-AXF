"""Minimal Docker Engine API client (stdlib only) for the locked-down socket proxy.

The console never mounts the Docker socket. It talks to ``axf-docker-proxy`` (deploy/haproxy.cfg), which allows only:
list/inspect containers, the archive API (GET/HEAD/PUT), exec (create/start/resize/inspect) and restart.
``AXF_DOCKER_PROXY`` = ``http://host:port`` (default ``http://axf-docker-proxy:2375``) or ``unix:///path`` (tests, dev).
"""
from __future__ import annotations

import base64
import http.client
import io
import json
import os
import socket
import struct
import tarfile
import time
import urllib.parse
from typing import Any, Callable, Iterator

DEFAULT_URL = "http://axf-docker-proxy:2375"


class DockerError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class _UnixConn(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float):
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self) -> None:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect(self._path)
        self.sock = s


def proxy_url() -> str:
    return os.environ.get("AXF_DOCKER_PROXY", DEFAULT_URL).strip() or DEFAULT_URL


def _q(v: str) -> str:
    return urllib.parse.quote(v, safe="")


class Docker:
    def __init__(self, url: str | None = None):
        self.url = url or proxy_url()
        u = urllib.parse.urlparse(self.url)
        if u.scheme == "unix":
            self._unix = u.path
            self._host, self._port = "", 0
        elif u.scheme == "http":
            self._unix = ""
            self._host, self._port = u.hostname or "localhost", u.port or 2375
        else:
            raise ValueError("AXF_DOCKER_PROXY must be http://host:port or unix:///path")

    # ------------------------------------------------------------ transport
    def _conn(self, timeout: float) -> http.client.HTTPConnection:
        if self._unix:
            return _UnixConn(self._unix, timeout)
        return http.client.HTTPConnection(self._host, self._port, timeout=timeout)

    def _raw_socket(self, timeout: float) -> socket.socket:
        if self._unix:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(timeout)
            s.connect(self._unix)
            return s
        return socket.create_connection((self._host, self._port), timeout=timeout)

    def request(self, method: str, path: str, query: dict[str, Any] | None = None, body: bytes | dict | None = None,
                headers: dict[str, str] | None = None, timeout: float = 30) -> tuple[int, dict[str, str], bytes]:
        conn, resp = self.open(method, path, query, body, headers, timeout)
        try:
            data = resp.read()
        finally:
            conn.close()
        return resp.status, {k.lower(): v for k, v in resp.getheaders()}, data

    def open(self, method: str, path: str, query: dict[str, Any] | None = None, body: bytes | dict | None = None,
             headers: dict[str, str] | None = None, timeout: float = 30):
        """Send a request and return (connection, response) with the body unread (for streams)."""
        if query:
            path += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        h = dict(headers or {})
        if hasattr(body, "read") and hasattr(body, "fileno"):  # a file: stream it with a known length
            h.setdefault("Content-Length", str(os.fstat(body.fileno()).st_size - body.tell()))
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        conn = self._conn(timeout)
        try:
            conn.request(method, path, body=body, headers=h)
            resp = conn.getresponse()
        except OSError as e:
            conn.close()
            raise DockerError(503, f"Docker proxy unreachable at {self.url} ({e}). Run deploy/install-console.sh on the VPS.") from e
        if resp.status >= 400:
            data = resp.read()
            conn.close()
            msg = data.decode("utf-8", "replace")
            try:
                msg = json.loads(msg).get("message", msg)
            except Exception:  # noqa: BLE001
                pass
            if resp.status == 403:
                msg = f"the Docker proxy refused {method} {path.split('?')[0]} (not on its allow list)"
            raise DockerError(resp.status, msg.strip() or resp.reason)
        return conn, resp

    def json(self, method: str, path: str, **kw) -> Any:
        _s, _h, data = self.request(method, path, **kw)
        return json.loads(data) if data else None

    # ------------------------------------------------------------ containers
    def ping(self) -> dict[str, Any]:
        return self.json("GET", "/version", timeout=5)

    def containers(self) -> list[dict[str, Any]]:
        return self.json("GET", "/containers/json", query={"all": "1"}, timeout=10) or []

    def inspect(self, cid: str) -> dict[str, Any]:
        return self.json("GET", f"/containers/{_q(cid)}/json", timeout=10)

    def restart(self, cid: str, timeout: int = 20) -> None:
        self.request("POST", f"/containers/{_q(cid)}/restart", query={"t": str(timeout)}, timeout=timeout + 30)

    # ------------------------------------------------------------ archive API
    def stat(self, cid: str, path: str) -> dict[str, Any] | None:
        try:
            _s, h, _d = self.request("HEAD", f"/containers/{_q(cid)}/archive", query={"path": path}, timeout=15)
        except DockerError as e:
            if e.status == 404:
                return None
            raise
        raw = h.get("x-docker-container-path-stat")
        if not raw:
            return {}
        st = json.loads(base64.b64decode(raw + "=" * (-len(raw) % 4)))
        mode = int(st.get("mode", 0))
        st["isDir"] = bool(mode & (1 << 31))
        st["isLink"] = bool(mode & (1 << 27))
        st["perm"] = mode & 0o7777
        return st

    def get_archive(self, cid: str, path: str, timeout: float = 120):
        """Open a tar stream of ``path``. Returns (conn, resp); the caller reads and closes."""
        return self.open("GET", f"/containers/{_q(cid)}/archive", query={"path": path}, timeout=timeout)

    def put_archive(self, cid: str, dest_dir: str, tar_bytes: Any, timeout: float = 120) -> None:
        """``tar_bytes``: bytes, or an open file positioned at the start of an uncompressed tar."""
        self.request("PUT", f"/containers/{_q(cid)}/archive", query={"path": dest_dir, "noOverwriteDirNonDir": "true"},
                     body=tar_bytes, headers={"Content-Type": "application/x-tar"}, timeout=timeout)

    def read_file(self, cid: str, path: str, max_bytes: int) -> tuple[bytes, bool, dict[str, Any]]:
        """(content, truncated, info) of one regular file."""
        conn, resp = self.get_archive(cid, path, timeout=60)
        try:
            with tarfile.open(fileobj=resp, mode="r|") as tf:
                for m in tf:
                    if m.isdir():
                        raise DockerError(400, f"{path} is a directory")
                    if m.issym() or m.islnk():
                        raise DockerError(400, f"{path} is a link to {m.linkname}; read the target instead")
                    if not m.isfile():
                        raise DockerError(400, f"{path} is not a regular file")
                    f = tf.extractfile(m)
                    data = f.read(max_bytes + 1) if f else b""
                    info = {"size": m.size, "mode": m.mode, "uid": m.uid, "gid": m.gid, "mtime": m.mtime}
                    return data[:max_bytes], len(data) > max_bytes, info
        finally:
            conn.close()
        raise DockerError(404, f"{path} not found")

    def write_file(self, cid: str, path: str, data: bytes, mode: int = 0o644, uid: int = 0, gid: int = 0) -> None:
        d, name = path.rsplit("/", 1)
        d = d or "/"
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tf:
            ti = tarfile.TarInfo(name)
            ti.size, ti.mode, ti.uid, ti.gid, ti.mtime = len(data), mode, uid, gid, int(time.time())
            tf.addfile(ti, io.BytesIO(data))
        self.put_archive(cid, d, buf.getvalue())

    # ------------------------------------------------------------ exec
    def exec_create(self, cid: str, cmd: list[str], user: str = "", workdir: str = "", env: list[str] | None = None,
                    tty: bool = False, stdin: bool = False) -> str:
        body: dict[str, Any] = {"AttachStdout": True, "AttachStderr": True, "AttachStdin": stdin, "Tty": tty, "Cmd": cmd,
                                "Privileged": False}
        if user:
            body["User"] = user
        if workdir:
            body["WorkingDir"] = workdir
        if env:
            body["Env"] = env
        return self.json("POST", f"/containers/{_q(cid)}/exec", body=body, timeout=15)["Id"]

    def exec_inspect(self, eid: str) -> dict[str, Any]:
        return self.json("GET", f"/exec/{_q(eid)}/json", timeout=10)

    def exec_resize(self, eid: str, cols: int, rows: int) -> None:
        try:
            self.request("POST", f"/exec/{_q(eid)}/resize", query={"h": str(rows), "w": str(cols)}, timeout=5)
        except DockerError:
            pass

    def run(self, cid: str, cmd: list[str], user: str = "", workdir: str = "", env: list[str] | None = None,
            timeout: float = 60, max_output: int = 1_000_000, on_output: Callable[[str, str], None] | None = None) -> dict[str, Any]:
        """Run a command to completion. Output is demultiplexed; ``on_output(stream, text)`` gets it live.
        The command is wrapped in ``timeout`` when the container has it, so a slow command is killed, not orphaned."""
        wrapped = ["sh", "-c", 'if command -v timeout >/dev/null 2>&1; then exec timeout -s KILL "$0" "$@"; else exec "$@"; fi',
                   str(int(timeout)), *cmd]
        res = self._run_once(cid, wrapped, user, workdir, env, timeout, max_output, on_output)
        if res["exitCode"] in (126, 127) and "executable file not found" in res["output"] and '"sh"' in res["output"]:
            res = self._run_once(cid, cmd, user, workdir, env, timeout, max_output, on_output)  # no shell in this image
        return res

    def _run_once(self, cid: str, cmd: list[str], user: str, workdir: str, env: list[str] | None, timeout: float,
                  max_output: int, on_output: Callable[[str, str], None] | None) -> dict[str, Any]:
        eid = self.exec_create(cid, cmd, user=user, workdir=workdir, env=env)
        conn, resp = self.open("POST", f"/exec/{_q(eid)}/start", body={"Detach": False, "Tty": False}, timeout=timeout + 15)
        out: list[str] = []
        size = 0
        truncated = False
        deadline = time.time() + timeout + 10
        try:
            for stream, chunk in _demux(resp):
                text = chunk.decode("utf-8", "replace")
                if on_output:
                    on_output(stream, text)
                if size < max_output:
                    out.append(text[: max_output - size])
                    size += len(text)
                else:
                    truncated = True
                if time.time() > deadline:
                    truncated = True
                    break
        except (socket.timeout, TimeoutError):
            truncated = True
        finally:
            conn.close()
        code = None
        for _ in range(20):
            info = self.exec_inspect(eid)
            if not info.get("Running"):
                code = info.get("ExitCode")
                break
            time.sleep(0.1)
        return {"exitCode": code, "output": "".join(out), "truncated": truncated}

    def tty(self, cid: str, cmd: list[str], user: str = "0", workdir: str = "", env: list[str] | None = None,
            cols: int = 100, rows: int = 30) -> "TtySession":
        eid = self.exec_create(cid, cmd, user=user, workdir=workdir, env=env, tty=True, stdin=True)
        sock = self._raw_socket(timeout=15)
        body = json.dumps({"Detach": False, "Tty": True}).encode()
        req = (f"POST /exec/{_q(eid)}/start HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\n"
               f"Connection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: {len(body)}\r\n\r\n").encode() + body
        sock.sendall(req)
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = sock.recv(4096)
            if not chunk:
                break
            head += chunk
        line = head.split(b"\r\n", 1)[0].decode("latin-1")
        if " 101 " not in line + " " and " 200 " not in line + " ":
            sock.close()
            raise DockerError(502, f"exec attach failed: {line}")
        rest = head.split(b"\r\n\r\n", 1)[1] if b"\r\n\r\n" in head else b""
        sock.settimeout(None)
        s = TtySession(self, eid, sock, rest)
        s.resize(cols, rows)
        return s


class TtySession:
    """An interactive exec with a TTY: raw bytes both ways (no multiplexing when Tty is on)."""

    def __init__(self, docker: Docker, eid: str, sock: socket.socket, pending: bytes):
        self.docker, self.id, self.sock, self._pending = docker, eid, sock, pending
        self.closed = False

    def read(self, n: int = 65536) -> bytes:
        if self._pending:
            d, self._pending = self._pending, b""
            return d
        try:
            return self.sock.recv(n)
        except OSError:
            return b""

    def write(self, data: bytes) -> None:
        self.sock.sendall(data)

    def resize(self, cols: int, rows: int) -> None:
        self.docker.exec_resize(self.id, max(10, min(cols, 500)), max(5, min(rows, 300)))

    def fileno(self) -> int:
        return self.sock.fileno()

    def close(self) -> None:
        if not self.closed:
            self.closed = True
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.sock.close()


def _demux(resp) -> Iterator[tuple[str, bytes]]:
    """Docker's multiplexed stream: 8-byte header (stream, 0, 0, 0, size BE32) then the payload."""
    names = {0: "stdin", 1: "stdout", 2: "stderr"}
    while True:
        head = _read_exact(resp, 8)
        if len(head) < 8:
            return
        stream, size = head[0], struct.unpack(">I", head[4:8])[0]
        if head[1:4] != b"\x00\x00\x00":  # not multiplexed (a TTY exec): pass through raw
            yield "stdout", head + resp.read1(65536)
            while True:
                more = resp.read1(65536)
                if not more:
                    return
                yield "stdout", more
        data = _read_exact(resp, size)
        yield names.get(stream, "stdout"), data


def _read_exact(resp, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = resp.read(n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf
