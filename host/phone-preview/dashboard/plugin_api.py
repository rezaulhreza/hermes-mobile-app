"""A page of a server on the Hermes host, shown on the phone: mounted at
``/api/plugins/phone-preview``.

A development server on the host (``localhost:3000``) cannot be reached from a phone. This
route fetches the page on the host and hands it to the app's preview, with the app's sign-in.

* ``GET /api/plugins/phone-preview/host?url=<absolute>``: the ENTRY. The preview points at
  it. The HTML is rewritten so that every asset comes back through this route.
* ``GET /api/plugins/phone-preview/host/<origin>/<path>``: the ASSETS. The origin is in the
  path, so a relative import of a module resolves the way it would against the real server.

Only the host itself can be a target: ``localhost``, ``127.x``, ``::1``, and a name that ends
in a domain listed in ``preview.local_domains`` of ``config.yaml`` AND resolves to loopback
(``app.test`` from a local-development tool). Every redirect hop is checked again.

The routes are behind the dashboard's sign-in, like every other ``/api`` route. The preview of
the app sends the session cookie with the page and with each asset.
"""

from __future__ import annotations

import base64
import ipaddress
import re
import socket
import urllib.parse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response


router = APIRouter()

# Where the dashboard mounts this file. The rewritten assets of a page point back here.
ROUTE = "/api/plugins/phone-preview"

_PREVIEW_TIMEOUT_S = 20.0
_PREVIEW_MAX_BYTES = 25 * 1024 * 1024
_PREVIEW_MAX_REDIRECTS = 5
_REDIRECT_CODES = frozenset({301, 302, 303, 307, 308})

# Attributes whose value is a fetchable sub-resource. `data-src` covers the
# lazy-loading pattern; `poster` covers video.
_ATTR_RE = re.compile(
    r"""(?P<attr>\b(?:src|href|poster|data-src)\s*=\s*)(?P<q>["'])(?P<url>[^"']*)(?P=q)""",
    re.IGNORECASE,
)
_CSS_URL_RE = re.compile(r"""url\(\s*(?P<q>["']?)(?P<url>[^)"']+)(?P=q)\s*\)""", re.IGNORECASE)
_BASE_TAG_RE = re.compile(r"<base\b[^>]*>", re.IGNORECASE)
_HEAD_OPEN_RE = re.compile(r"(<head\b[^>]*>)", re.IGNORECASE)

# Schemes/prefixes that are never a network fetch and must pass through untouched.
_NON_FETCH_PREFIXES = ("#", "data:", "blob:", "javascript:", "mailto:", "tel:", "about:")


# --------------------------------------------------------------------------
# SSRF boundary
# --------------------------------------------------------------------------

def _local_domains() -> tuple[str, ...]:
    """``preview.local_domains`` from config.yaml: the local-development TLDs of this host
    (``test`` for Laravel Herd / Valet, ``localhost``). Empty by default, so a stock install
    reaches the three loopback spellings and nothing else."""
    try:
        from hermes_cli.config import load_config_readonly

        section = (load_config_readonly() or {}).get("preview")
        names = section.get("local_domains") if isinstance(section, dict) else None
    except Exception:  # noqa: BLE001 - an unreadable config must not widen the boundary
        return ()
    if not isinstance(names, list):
        return ()
    return tuple(str(name).lower().strip(". ") for name in names if str(name).strip(". "))


def _resolves_to_loopback(host: str) -> bool:
    """Every address the resolver gives for ``host`` is loopback (and it gives at least one)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    addresses = {info[4][0].split("%")[0] for info in infos}
    try:
        return bool(addresses) and all(ipaddress.ip_address(address).is_loopback for address in addresses)
    except ValueError:
        return False


def _host_is_loopback(host: str) -> bool:
    """True for the three loopback spellings, and for a name under a configured local
    domain that resolves to loopback. A hostname is never trusted by suffix alone
    (``localhost.evil.com`` is not loopback; DNS names resolve to whatever the resolver
    says): the opt-in list names whole TLDs the machine's owner runs a local resolver
    for, the name must END in one of them, and its addresses must all be loopback. The
    check runs again on every fetch and every redirect hop."""
    host = (host or "").lower().rstrip(".")
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        pass
    return any(host.endswith(f".{domain}") for domain in _local_domains()) and _resolves_to_loopback(host)


def _is_loopback_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    return _host_is_loopback(parsed.hostname)


def _normalise_target(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="A preview URL is required")
    try:
        parsed = urllib.parse.urlparse(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="A preview URL is required") from exc
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="A preview URL is required")
    if not _host_is_loopback(parsed.hostname):
        raise HTTPException(status_code=403, detail="Preview proxy only reaches loopback addresses")
    return text


# --------------------------------------------------------------------------
# Target encoding (origin <-> path segment)
# --------------------------------------------------------------------------

def _origin_of(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _encode_origin(origin: str) -> str:
    return base64.urlsafe_b64encode(origin.encode("utf-8")).decode("ascii").rstrip("=")


def _decode_origin(encoded: str) -> str:
    padding = "=" * (-len(encoded) % 4)
    try:
        decoded = base64.urlsafe_b64decode(encoded + padding).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Malformed preview target")
    if not _is_loopback_url(decoded):
        raise HTTPException(status_code=403, detail="Preview proxy only reaches loopback addresses")
    return decoded


def _proxy_prefix(origin: str) -> str:
    return f"{ROUTE}/host/{_encode_origin(origin)}"


# --------------------------------------------------------------------------
# Fetch (redirect-safe)
# --------------------------------------------------------------------------

async def _fetch_target(target: str) -> tuple[int, bytes, str, str]:
    """Fetch ``target``, re-validating the loopback boundary on every hop.

    Returns ``(status, body, content_type, final_url)``. ``final_url`` is where the body
    came from after the redirects: its references resolve against that address, not the
    one that was asked for (a site that redirects http to https links its assets as https). ``follow_redirects`` is off so a
    loopback server cannot 302 us to a public host: each Location is checked
    against the same boundary before it is followed.
    """
    import httpx

    current = target
    # verify=False: every hop is checked to be loopback before it is fetched, and a local-development
    # site signs its certificate with an authority of the machine (Herd, Valet, mkcert) that the
    # bundled CA list does not know. On loopback there is no network between the two ends to protect.
    async with httpx.AsyncClient(timeout=_PREVIEW_TIMEOUT_S, follow_redirects=False, verify=False) as client:
        for _ in range(_PREVIEW_MAX_REDIRECTS + 1):
            if not _is_loopback_url(current):
                raise HTTPException(status_code=403, detail="Preview proxy only reaches loopback addresses")
            try:
                response = await client.get(current, headers={"accept": "*/*"})
            except Exception as exc:  # noqa: BLE001 - surface any transport failure as 502
                raise HTTPException(status_code=502, detail=f"Preview fetch failed: {exc}") from exc
            location = response.headers.get("location")
            if response.status_code in _REDIRECT_CODES and location:
                current = urllib.parse.urljoin(current, location)
                continue
            body = response.content
            if len(body) > _PREVIEW_MAX_BYTES:
                raise HTTPException(status_code=413, detail="Preview target is too large")
            content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
            return response.status_code, body, content_type, current
    raise HTTPException(status_code=502, detail="Preview fetch followed too many redirects")


# --------------------------------------------------------------------------
# HTML rewrite
# --------------------------------------------------------------------------

def _proxy_ref(raw: str, doc_url: str, origin: str, prefix: str) -> str | None:
    """Rewrite one same-origin reference to its proxied path, or None to leave
    it alone (a non-fetch scheme, an empty value, or a cross-origin URL the
    phone can reach on its own)."""
    ref = (raw or "").strip()
    if not ref or ref.startswith(_NON_FETCH_PREFIXES):
        return None
    absolute = urllib.parse.urljoin(doc_url, ref)
    if _origin_of(absolute) != origin:
        return None
    parsed = urllib.parse.urlparse(absolute)
    path = parsed.path or "/"
    query = f"?{parsed.query}" if parsed.query else ""
    return f"{prefix}{path}{query}"


def _rewrite_html(body: bytes, doc_url: str) -> bytes:
    """Rewrite same-origin sub-resource references and inject a ``<base>``.

    Root-relative refs (``/src/main.tsx``) would otherwise resolve against the
    GATEWAY origin, not the dev server, so they are rewritten here. The base
    tag covers anything this pass misses (a relative ref added by a script),
    pointing it at the proxied directory rather than the raw target.
    """
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return body

    origin = _origin_of(doc_url)
    prefix = _proxy_prefix(origin)
    parsed = urllib.parse.urlparse(doc_url)
    directory = parsed.path.rsplit("/", 1)[0] + "/" if "/" in parsed.path else "/"
    base_href = f"{prefix}{directory}"

    def _attr_repl(match: re.Match[str]) -> str:
        rewritten = _proxy_ref(match.group("url"), doc_url, origin, prefix)
        if rewritten is None:
            return match.group(0)
        return f'{match.group("attr")}{match.group("q")}{rewritten}{match.group("q")}'

    text = _ATTR_RE.sub(_attr_repl, text)

    def _css_repl(match: re.Match[str]) -> str:
        rewritten = _proxy_ref(match.group("url"), doc_url, origin, prefix)
        if rewritten is None:
            return match.group(0)
        quote = match.group("q")
        return f"url({quote}{rewritten}{quote})"

    text = _CSS_URL_RE.sub(_css_repl, text)

    base_tag = f'<base href="{base_href}">'
    if _BASE_TAG_RE.search(text):
        text = _BASE_TAG_RE.sub(base_tag, text, count=1)
    elif _HEAD_OPEN_RE.search(text):
        text = _HEAD_OPEN_RE.sub(lambda m: m.group(1) + base_tag, text, count=1)
    else:
        text = base_tag + text

    return text.encode("utf-8")


# --------------------------------------------------------------------------
# Response
# --------------------------------------------------------------------------

def _preview_response(request: Request, status: int, body: bytes, content_type: str) -> Response:
    return Response(
        content=body,
        # The target's own status is passed through (a 404 asset reads as 404 in the preview,
        # not as a failure of this route); a transport failure is the 502 of _fetch_target.
        status_code=status if 100 <= status < 600 else 502,
        media_type=content_type or "application/octet-stream",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@router.get("/host")
async def preview_host_entry(request: Request, url: str = ""):
    """Entry point: fetch one loopback document and rewrite its assets."""
    target = _normalise_target(url)
    status, body, content_type, final_url = await _fetch_target(target)
    if content_type.startswith("text/html"):
        body = _rewrite_html(body, final_url)
    return _preview_response(request, status, body, content_type)


@router.get("/host/{encoded}")
@router.get("/host/{encoded}/{subpath:path}")
async def preview_host_asset(request: Request, encoded: str, subpath: str = ""):
    """Sub-resource leg: decode the origin, join the path, fetch it."""
    origin = _decode_origin(encoded)
    target = urllib.parse.urljoin(origin + "/", subpath)
    if not _is_loopback_url(target):
        raise HTTPException(status_code=403, detail="Preview proxy only reaches loopback addresses")
    status, body, content_type, final_url = await _fetch_target(target)
    if content_type.startswith("text/html"):
        body = _rewrite_html(body, final_url)
    return _preview_response(request, status, body, content_type)


# The HTTP leg above is complete; the WebSocket leg is not. A Vite/dev-server
# HMR client opens `ws://<origin>/` (or a subpath) for live reload. Carrying it
# needs a `@router.websocket` bridge with its own origin policy and a raw socket
# splice to the loopback target — deliberately out of scope for this pass.
# Consequence: the phone renders the page and its assets, but live reload does
# not fire; reload the pane after a change.
_HMR_LIMITATION = "hmr-websocket-not-proxied"
