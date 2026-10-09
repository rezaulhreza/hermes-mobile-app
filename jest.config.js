/** Pure logic only, on Node. Screens are checked on a device, not in jest. */
// The preset ships inside `expo` and is not hoisted, so resolve it from there.
const preset = require.resolve("babel-preset-expo", { paths: [require.resolve("expo/package.json")] });

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: { "^.+\\.[jt]sx?$": ["babel-jest", { presets: [preset] }] },
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  clearMocks: true,
};
