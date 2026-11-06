const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

/**
 * Lint, from the Expo preset, with build outputs and vendored code ignored.
 *
 * `expo lint` used to prompt to install this on a first run, which is a bad
 * habit in a repository that other people and CI run. The config is committed
 * instead.
 */
module.exports = defineConfig([
  expoConfig,
  {
    // src/core/gateway is vendored from the Hermes repo and keeps its own style.
    ignores: ["dist/**", ".expo/**", ".claude/**", "node_modules/**", "ios/**", "android/**", "src/core/gateway/**", "src/core/preview/act-engine.generated.ts", "src/components/terminal/xterm.generated.ts", "src/components/render/render.generated.ts"],
  },
]);
