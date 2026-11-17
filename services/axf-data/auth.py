"""axf-data token auth (data-token@1, framework/spec/DATA-STORE.md → Auth).

Two ways a caller proves who it is; both end in the same `Principal { sub, grants, jti }`:

1. data-token@1: a compact JWS (EdDSA, `typ: axf-data+jwt`) issued by axHub. The key set is read from
   AXF_DATA_KEYS_URL (`<hub>/.well-known/axf-keys.json`) at boot and hourly, or AXF_DATA_KEYS_FILE; the last good copy is
   kept on the volume (`keys.json`) so verification works while axHub is down.
2. Service tokens from AXF_DATA_TOKENS_FILE (`{ "tokens": [{ "id", "sub", "sha256", "grants" }] }`): only the SHA-256 of
   each token is on disk. The installer writes this file until axHub issues data tokens for every service.

A revoked `jti` / token id (DELETE /v1/_meta/tokens/<id>) answers `unauthorized`.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from store import NAMESPACES, REG, DataError

OPS_GRANT = {'get': 'read', 'list': 'read', 'read': 'read', 'manifest': 'read', 'watch': 'read', 'history': 'read',
             'put': 'write', 'delete': 'write', 'append': 'append', 'restore': 'write', 'snapshot': 'admin', 'admin': 'admin'}
TOKEN = REG['token']


@dataclass
class Principal:
    sub: str
    grants: dict = field(default_factory=dict)
    jti: str = ''

    def allows(self, op: str, ns: str, path: str = '') -> bool:
        need = OPS_GRANT.get(op, 'admin')
        key = f'{ns}/{path}' if path else ns
        for scope, granted in self.grants.items():
            g = set(granted or [])
            if 'admin' in g or need in g or (need == 'append' and 'write' in g):
                if scope == '*' or scope == ns or key == scope or key.startswith(scope.rstrip('/') + '/'):
                    if ns == '_meta' and scope != '_meta' and 'admin' not in g and scope != '*':
                        continue
                    return True
        return False

    def need(self, op: str, ns: str, path: str = '') -> None:
        if not self.allows(op, ns, path):
            raise DataError('forbidden', f'{self.sub} has no {OPS_GRANT.get(op, "admin")} grant on {ns}{"/" + path if path else ""}', ns=ns, path=path or None)


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


class Auth:
    def __init__(self, data_dir: Path, revoked=lambda jti: False):
        self.dir = Path(data_dir)
        self.revoked = revoked
        self.keys: dict = {}
        self.fetched_at = ''
        self.verified = False
        self.lock = threading.Lock()
        self.tokens: list = []
        self.reload()

    # ── key set + service tokens ──
    def reload(self) -> None:
        tf = os.environ.get('AXF_DATA_TOKENS_FILE', '')
        if tf and Path(tf).is_file():
            self.tokens = json.loads(Path(tf).read_text('utf-8')).get('tokens', [])
        cache = self.dir / 'keys.json'
        doc = None
        url = os.environ.get('AXF_DATA_KEYS_URL', '')
        if url:
            try:
                with urllib.request.urlopen(url, timeout=5) as r:  # noqa: S310 (internal network, operator-set URL)
                    doc = json.loads(r.read())
                cache.write_text(json.dumps(doc), 'utf-8')
                self.verified = True
                self.fetched_at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            except (OSError, ValueError):
                doc = None
        kf = os.environ.get('AXF_DATA_KEYS_FILE', '')
        if doc is None and kf and Path(kf).is_file():
            doc = json.loads(Path(kf).read_text('utf-8'))
        if doc is None and cache.is_file():
            doc = json.loads(cache.read_text('utf-8'))
        with self.lock:
            self.keys = {k['kid']: k for k in (doc or {}).get('keys', []) if k.get('kty') == 'OKP' and k.get('crv') == 'Ed25519'}

    def health(self) -> dict:
        return {'verified': self.verified, 'fetchedAt': self.fetched_at}

    # ── verification ──
    def principal(self, authorization: str | None, actor: str | None = None) -> Principal:
        raw = (authorization or '').strip()
        if not raw.lower().startswith('bearer ') or not raw[7:].strip():
            raise DataError('unauthorized', 'no token: send Authorization: Bearer <data token>')
        tok = raw[7:].strip()
        p = self._jws(tok) if tok.count('.') == 2 else self._service(tok)
        if p.jti and self.revoked(p.jti):
            raise DataError('unauthorized', 'this token was revoked')
        if actor:
            p.sub = f'{p.sub}/{actor[:200]}'
        return p

    def _service(self, tok: str) -> Principal:
        digest = hashlib.sha256(tok.encode('utf-8')).hexdigest()
        for t in self.tokens:
            if hmac.compare_digest(str(t.get('sha256', '')), digest):
                return Principal(sub=str(t['sub']), grants=dict(t.get('grants') or {}), jti=str(t.get('id', '')))
        raise DataError('unauthorized', 'unknown token')

    def _jws(self, tok: str) -> Principal:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        h64, p64, s64 = tok.split('.')
        try:
            header = json.loads(_b64d(h64))
            claims = json.loads(_b64d(p64))
            sig = _b64d(s64)
        except ValueError as e:
            raise DataError('unauthorized', 'malformed token') from e
        if header.get('alg') != TOKEN['alg'] or header.get('typ') != TOKEN['typ']:
            raise DataError('unauthorized', 'wrong token type')
        key = self.keys.get(header.get('kid'))
        if not key:
            raise DataError('unauthorized', f"unknown kid {header.get('kid')!r}")
        try:
            Ed25519PublicKey.from_public_bytes(_b64d(key['x'])).verify(sig, f'{h64}.{p64}'.encode('ascii'))
        except (InvalidSignature, ValueError) as e:
            raise DataError('unauthorized', 'bad signature') from e
        now = time.time()
        if claims.get('iss') != TOKEN['iss'] or claims.get('aud') != TOKEN['aud']:
            raise DataError('unauthorized', 'wrong issuer or audience')
        if not isinstance(claims.get('exp'), (int, float)) or claims['exp'] < now:
            raise DataError('unauthorized', 'token expired')
        if claims['exp'] - claims.get('iat', 0) > REG['limits']['tokenTtlSeconds']:
            raise DataError('unauthorized', 'token lives longer than 24 h')
        sub = str(claims.get('sub', ''))
        if not sub.startswith(TOKEN['subPrefix']):
            raise DataError('unauthorized', 'bad subject')
        grants = claims.get('grants') or {}
        for scope in grants:
            if scope != '*' and scope.split('/')[0] not in NAMESPACES:
                raise DataError('unauthorized', f'grant on unknown namespace {scope!r}')
        return Principal(sub=sub, grants=grants, jti=str(claims.get('jti', '')))
