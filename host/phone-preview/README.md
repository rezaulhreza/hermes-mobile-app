# phone-preview

Shows a page of a server on the Hermes host in the preview of the phone app: a development
server on `localhost`, or a local-development site such as `app.test`.

## Install

1. Run `./install.sh` on the Hermes host.
2. Restart Hermes.

For a site that only the host's own resolver serves, list its domain in `config.yaml`:

```yaml
preview:
  local_domains: [test]
```

A name is taken only when it ends in a listed domain AND resolves to the host itself.

## Limits

- A page that needs a WebSocket to its server (hot reload) loads without it.
- The route does not check the certificate of a target: every hop is checked to be the host
  itself first, and a secured local site signs with an authority only that machine knows.

## After a Hermes update

Nothing to do. The plugin changes no file of Hermes and uses none of its private names.
