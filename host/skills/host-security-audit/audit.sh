#!/usr/bin/env bash
# Read-only security audit of a Hermes host.
#
# It changes nothing. It reports the exposure of this machine: the firewall,
# what listens beyond loopback, whether the tunnels reach the origin only over
# loopback, and whether the origin is reachable from the internet.
#
# Run it any time:   host/skills/host-security-audit/audit.sh
# It prints one line per check: PASS, WARN or FAIL, then a short summary.
#
# It names no person, no domain, no team and no token. It discovers everything
# from the live machine, so it is safe to keep in the repository.

set -u

pass=0; warn=0; fail=0
PASS() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
WARN() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; warn=$((warn+1)); }
FAIL() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
INFO() { printf '  ----  %s\n' "$1"; }
head() { printf '\n== %s ==\n' "$1"; }

echo "Hermes host security audit -- $(date '+%Y-%m-%d %H:%M %Z')"

# 1. macOS application firewall ------------------------------------------------
head "Firewall"
if [ "$(uname)" = "Darwin" ]; then
  fw=/usr/libexec/ApplicationFirewall/socketfilterfw
  state="$("$fw" --getglobalstate 2>/dev/null)"
  stealth="$("$fw" --getstealthmode 2>/dev/null)"
  case "$state" in
    *enabled*) PASS "application firewall is on" ;;
    *)         FAIL "application firewall is OFF -- every non-loopback listener is reachable on the LAN" ;;
  esac
  case "$stealth" in
    *on*) PASS "stealth mode is on (host does not answer probes)" ;;
    *)    WARN "stealth mode is off -- the host answers pings and port probes" ;;
  esac
else
  INFO "not macOS; check the host firewall for this platform"
fi

# 2. What listens beyond loopback ---------------------------------------------
head "Listeners beyond loopback"
# A listener on 127.0.0.1 or [::1] is local only. Anything on * / 0.0.0.0 / a LAN
# address is reachable by other machines on the network.
exposed="$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
  | awk 'NR>1 && $9 !~ /^127\.0\.0\.1:/ && $9 !~ /^\[::1\]:/ {print "    " $1 "  " $9}' \
  | sort -u)"
if [ -n "$exposed" ]; then
  WARN "these listen on all interfaces (reachable on the LAN unless the firewall blocks them):"
  printf '%s\n' "$exposed"
  INFO "stock macOS services (AirPlay 5000/7000, Handoff/rapportd 49152) are expected; the firewall should still gate them"
else
  PASS "nothing listens beyond loopback"
fi

# 3. cloudflared tunnels reach the origin over loopback only ------------------
head "Tunnel -> origin path"
cfgs="$(find "$HOME/.cloudflared" /etc/cloudflared -name '*.yml' -o -name '*.yaml' 2>/dev/null)"
if [ -z "$cfgs" ]; then
  INFO "no cloudflared config found"
else
  bad=0
  for c in $cfgs; do
    # Any ingress service that is not 127.0.0.1 / localhost / a http_status is a smell.
    offenders="$(grep -nE '^\s*service:\s*https?://' "$c" 2>/dev/null \
      | grep -vE '127\.0\.0\.1|localhost' || true)"
    if [ -n "$offenders" ]; then
      WARN "a tunnel service in $(basename "$c") does not point at loopback:"
      printf '    %s\n' "$offenders"
      bad=1
    fi
  done
  [ "$bad" = 0 ] && PASS "every tunnel ingress reaches the origin over 127.0.0.1 / localhost"
  # Log level: debug writes every request path to disk.
  if grep -qiE '^\s*loglevel:\s*debug' $cfgs 2>/dev/null; then
    WARN "a tunnel runs at loglevel: debug -- it logs every request path; set it to info"
  else
    PASS "no tunnel is at loglevel: debug"
  fi
fi

# 4. Is the origin reachable from the internet? -------------------------------
head "Internet exposure of the origin"
pub="$(curl -sS -m 8 https://api.ipify.org 2>/dev/null || true)"
if [ -z "$pub" ]; then
  INFO "could not learn the public IP (offline?); check the router port-forward table by hand"
else
  INFO "public IP: $pub"
  reach=0
  for p in 80 443; do
    if curl -sS -m 6 -k -o /dev/null "https://$pub:$p/" 2>/dev/null; then reach=1; fi
  done
  if [ "$reach" = 1 ]; then
    FAIL "port 80 or 443 answers on the public IP -- the origin may be forwarded past Cloudflare; check the router"
  else
    PASS "ports 80/443 do not answer on the public IP from here (confirm in the router's port-forward table)"
  fi
fi

# 5. Summary ------------------------------------------------------------------
head "Summary"
printf '  %d pass, %d warn, %d fail\n' "$pass" "$warn" "$fail"
[ "$fail" -gt 0 ] && exit 2
[ "$warn" -gt 0 ] && exit 1
exit 0
