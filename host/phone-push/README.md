# phone-push

Push notifications for the phone app. Hermes sends one when the agent waits for you (an
approval, a question, a password) or when a bot addresses you. It goes through Apple, with
YOUR key. An approval can be answered from the notification.

## Install

1. Run `./install.sh` on the Hermes host.
2. Add the settings below to `config.yaml` in the Hermes home.
3. Restart Hermes.

```yaml
push:
  enabled: true
  apns_key_path: /path/to/AuthKey.p8     # your key from the Apple developer account
  apns_key_id: "<key id>"
  apns_team_id: "<team id>"
  bundle_id: "<the bundle identifier the app is built with>"
  environment: production                # or: sandbox, for a development build
  kinds: [clarify, approval, mention, sudo, secret]
```

The Hermes environment needs the `h2` package (HTTP/2, which Apple requires).

## Check it

- `GET /api/plugins/phone-push/status` says whether it is on, how many phones are known, and
  `hooks: {request, mention}`. Both must be `true`.
- `POST /api/plugins/phone-push/test` sends a test notification to every registered phone.

## After a Hermes update

The plugin changes no file of Hermes. It wraps two functions of Hermes when the process
starts. If an update renames one of them, the notifications of that kind stop and `status`
shows `false` for it. `push/hooks.py` names both functions and says what to do.
