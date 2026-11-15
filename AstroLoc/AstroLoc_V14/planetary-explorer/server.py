#!/usr/bin/env python3
"""
planetary-explorer-v2/server.py
Standalone static server and allowlisted HTTPS proxy for Earth, Moon, and Mars data.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote
from urllib.request import Request, build_opener, HTTPSHandler, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
from pathlib import Path
import http.client
import json
import os
import random
import socket
import ssl
import sys

ROOT = Path(__file__).resolve().parent
ALLOWED_HOSTS = {
    "pds.nasa.gov", "pds.mcp.nasa.gov", "api.nasa.gov", "trek.nasa.gov",
    "gibs.earthdata.nasa.gov", "svs.gsfc.nasa.gov", "astrogeology.usgs.gov",
    "planetarymaps.usgs.gov", "pds-geosciences.wustl.edu", "pds-imaging.jpl.nasa.gov",
    "pds-atmospheres.nmsu.edu", "pds-rings.seti.org",
    "pds-smallbodies.astro.umd.edu", "pds-ppi.igpp.ucla.edu",
    "s3.amazonaws.com", "nominatim.openstreetmap.org",
}
DEFAULT_PORT = int(os.environ.get("PORT", 8082))
ACTIVE_PORT = DEFAULT_PORT
TIMEOUT, MAX_BODY = 60, 80 * 1024 * 1024
_DNS_CACHE = {}

def _query_dns_tcp(server, name, timeout=5):
    qname = b"".join(bytes([len(p)]) + p.encode() for p in name.split(".")) + b"\x00"
    qid = random.randrange(65536)
    header = qid.to_bytes(2, "big") + b"\x01\x00\x00\x01" + b"\x00\x00" * 3
    question = qname + b"\x00\x01\x00\x01"
    msg = header + question
    try:
        with socket.create_connection((server, 53), timeout=timeout) as s:
            s.sendall(len(msg).to_bytes(2, "big") + msg)
            s.settimeout(timeout)
            ln = int.from_bytes(s.recv(2), "big")
            buf = b""
            while len(buf) < ln:
                chunk = s.recv(ln - len(buf))
                if not chunk:
                    break
                buf += chunk
        i = 12
        while buf[i] != 0:
            if buf[i] & 0xC0:
                i += 2
                break
            i += 1 + buf[i]
        else:
            i += 1
        i += 4
        ancount = int.from_bytes(buf[6:8], "big")
        addrs = []
        for _ in range(ancount):
            if buf[i] & 0xC0:
                i += 2
            else:
                while buf[i] != 0:
                    i += 1 + buf[i]
                i += 1
            rtype = int.from_bytes(buf[i:i + 2], "big")
            rdlen = int.from_bytes(buf[i + 8:i + 10], "big")
            rdata = buf[i + 10:i + 10 + rdlen]
            i += 10 + rdlen
            if rtype == 1 and rdlen == 4:
                addrs.append(".".join(str(b) for b in rdata))
        return addrs
    except Exception:
        return []

def resolve_host(hostname):
    try:
        infos = socket.getaddrinfo(hostname, 443, proto=socket.IPPROTO_TCP)
        ips = sorted({a[4][0] for a in infos if "." in a[4][0]})
        if ips:
            return ips[0], "system-dns"
    except OSError:
        pass
    if hostname in _DNS_CACHE:
        return _DNS_CACHE[hostname], "cached-fallback-dns"
    for server in ("8.8.8.8", "1.1.1.1"):
        ips = _query_dns_tcp(server, hostname)
        if ips:
            _DNS_CACHE[hostname] = ips[0]
            return ips[0], f"fallback-dns({server})"
    raise URLError(f"DNS resolution failed for {hostname}.")

def _build_tls():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    for cafile in ("/etc/ssl/cert.pem", "/private/etc/ssl/cert.pem"):
        if os.path.exists(cafile):
            try:
                return ssl.create_default_context(cafile=cafile)
            except ssl.SSLError:
                pass
    return ssl.create_default_context()

TLS = _build_tls()

class AllowlistedRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urlparse(newurl)
        if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
            raise URLError("Redirect target is not an allowlisted HTTPS host.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, ip, hostname, timeout, context):
        super().__init__(hostname, timeout=timeout, context=context)
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port or 443), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)

OPENER = build_opener(HTTPSHandler(context=TLS), AllowlistedRedirectHandler())

def _open_upstream(target, method, headers, body):
    u = urlparse(target)
    last_reason = None
    for attempt in range(2):
        if attempt == 0:
            req = Request(target, data=body, headers=headers, method=method)
            try:
                return OPENER.open(req, timeout=TIMEOUT), "system-dns"
            except HTTPError:
                raise
            except (URLError, TimeoutError, OSError) as e:
                last_reason = getattr(e, "reason", e)
                msg = str(last_reason).lower()
                if not any(k in msg for k in ("name", "resolve", "nodename", "gaierror", "timed out", "timeout", "temporary failure")):
                    return None, last_reason
        else:
            ip, via = resolve_host(u.hostname)
            path = (u.path or "/") + (f"?{u.query}" if u.query else "")
            conn = PinnedHTTPSConnection(ip, u.hostname, TIMEOUT, TLS)
            conn.request(method, path, body=body, headers=headers)
            return conn.getresponse(), via
    return None, last_reason or URLError("upstream unreachable")

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def reply_json(self, status, obj):
        raw = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type, Range")
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path)
        if p.path == "/api/proxy":
            self.proxy(parse_qs(p.query).get("url", [""])[0], "GET")
        elif p.path == "/api/health":
            self.reply_json(200, {"ok": True, "project": "planetary-explorer-v2", "port": ACTIVE_PORT})
        else:
            super().do_GET()

    def do_POST(self):
        p = urlparse(self.path)
        if p.path == "/api/proxy":
            self.proxy(parse_qs(p.query).get("url", [""])[0], "POST")
        else:
            self.send_error(404)

    def proxy(self, target, method):
        try:
            u = urlparse(target)
            if u.query and (" " in u.query or '"' in u.query):
                target = u._replace(query=quote(u.query, safe="=&,:%()")).geturl()
                u = urlparse(target)
            if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
                return self.reply_json(400, {"error": f"Host {u.hostname} is not on the allowlist."})
            size = int(self.headers.get("Content-Length", "0") or 0)
            if size > MAX_BODY:
                return self.reply_json(413, {"error": "Request body too large."})
            body = self.rfile.read(size) if size else None
            headers = {
                "Accept": self.headers.get("Accept", "*/*"),
                "User-Agent": "Planetary-Explorer-V2/2.0 (Scientific Research Client)"
            }
            for h in ("Content-Type", "Range", "If-Range"):
                if self.headers.get(h):
                    headers[h] = self.headers[h]
            try:
                upstream, via = _open_upstream(target, method, headers, body)
                if upstream is None:
                    return self.reply_json(502, {"error": "Proxy could not reach upstream.", "detail": str(via)})
                status = upstream.status
                ctype = upstream.headers.get("Content-Type", "application/octet-stream")
                payload = upstream.read(MAX_BODY + 1)
                resp_headers = {
                    k: upstream.headers.get(k)
                    for k in ("Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Cache-Control")
                    if upstream.headers.get(k)
                }
                if via != "system-dns":
                    resp_headers["X-Proxy-DNS"] = via
            except HTTPError as e:
                status, ctype, payload = e.code, e.headers.get("Content-Type", "text/plain"), e.read(MAX_BODY + 1)
                resp_headers = {}
            if len(payload) > MAX_BODY:
                return self.reply_json(502, {"error": "Upstream response exceeds 80 MB limit."})
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Access-Control-Allow-Origin", "*")
            for k, v in resp_headers.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:
            self.reply_json(502, {"error": "Proxy request failed.", "detail": str(e)})

if __name__ == "__main__":
    host = "0.0.0.0"
    port = DEFAULT_PORT
    for i, arg in enumerate(sys.argv[1:]):
        if arg in ("--port", "-p") and i + 2 <= len(sys.argv[1:]):
            port = int(sys.argv[i + 2])
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer.daemon_threads = True
    httpd = None
    for candidate in range(port, port + 10):
        try:
            httpd = ThreadingHTTPServer((host, candidate), Handler)
            ACTIVE_PORT = candidate
            break
        except OSError:
            continue
    if httpd is None:
        sys.exit(1)
    print(f"planetary-explorer-v2 active at http://{host}:{ACTIVE_PORT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()
