# Hermes native

A React Native (Expo) app for [Hermes](https://github.com/NousResearch/hermes-agent):
the remote control for an agent that runs on your own machine.

```bash
npm install
npm run verify        # type check, lint, tests
npx expo run:ios      # local build; no cloud build service
```

On first launch, enter the address of your Hermes and your account. The app
stores them in the Keychain / Keystore.

Start with [docs/HANDOFF.md](docs/HANDOFF.md): layout, backend contract,
state, and remaining work.
