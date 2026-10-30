---
name: host-security-audit
description: "Use when the user asks whether the Hermes host is secure, wants a penetration test or security check of the machine, asks what is exposed to the network or the internet, or after changing the firewall, a tunnel, or a service that listens on a port. Runs a read-only audit of this host and reports what is exposed and what to fix."
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [security, pentest, audit, firewall, exposure, cloudflare, tunnel, hardening, network, host]
    category: devops
---

# Check whether this host is secure

This host runs the origin behind a Cloudflare tunnel. The safe shape is simple:

- The origin listens on `127.0.0.1` only. The tunnel is the one way in.
- The firewall is on, so nothing else on the network can reach a service by mistake.
- The internet cannot reach the origin ports directly, only through Cloudflare.

One command checks all of this and changes nothing.

## To audit the host

1. Run `{{REPO}}/host/skills/host-security-audit/audit.sh`.
2. Read the result. Each line is `PASS`, `WARN` or `FAIL`. The exit code is `0` for
   all pass, `1` if any warn, `2` if any fail.
3. Tell the user the summary line and every `FAIL` and `WARN`, in plain words.

## What each finding means

- **Firewall OFF (FAIL):** the macOS application firewall is off, so every service that
  listens on all interfaces is reachable by any machine on the same network. Fix: turn the
  firewall on, with stealth mode and block-incoming. Local development is not affected,
  because loopback (`127.0.0.1`) is always exempt.
- **Listeners beyond loopback (WARN):** these answer on the LAN. Stock macOS services
  (AirPlay on 5000/7000, Handoff on 49152) are expected; the firewall still gates them. Any
  application server here (for example a local web server) should either bind to `127.0.0.1`
  or be gated by the firewall.
- **Tunnel service not on loopback (WARN):** a tunnel points at a public address, not
  `127.0.0.1`. Point it at loopback so the origin is never on the network.
- **loglevel: debug (WARN):** the tunnel logs every request path. Set it to `info` once the
  mobile shell works.
- **Ports 80/443 answer on the public IP (FAIL):** the router may forward the origin ports
  past Cloudflare. Remove the port-forward so the tunnel is the only path in.

## The fix for the firewall

These need `sudo` and are reversible. Loopback stays open, so local development is untouched.
AirPlaying **out** from this host is never affected; it is an outgoing connection.

Recommended (targeted): turn the firewall on and block only the local web server from the
network. This keeps AirPlay-receive, AirDrop and Handoff working. Replace the path if the web
server differs; find it with `lsof -nP -iTCP:443 -sTCP:LISTEN`.

```sh
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "<web-server-binary>"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --block "<web-server-binary>"
```

Confirm the block: `socketfilterfw --getappblocked "<web-server-binary>"` must say the
incoming connection is blocked.

Stricter alternative: `--setblockall on` blocks all incoming, including AirPlay-receive and
AirDrop. Some macOS versions ignore this flag from the command line; check with
`--getblockall`. Use it only if this host never receives AirPlay or AirDrop.

To undo the targeted block: `socketfilterfw --unblock "<web-server-binary>"`.

Run the audit again after the change: the firewall line must read `PASS`.

## Rules

- The audit only reads. It never changes the host.
- The fix commands change the firewall, not the tunnel and not the origin. Keep the origin
  on `127.0.0.1` and keep the tunnel as the one way in.
