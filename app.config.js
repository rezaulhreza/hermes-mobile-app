/**
 * The values of a build that belong to whoever builds it come from the
 * environment, never from the tree: a bundle identifier names its owner.
 * With nothing set the app builds with the placeholder of `app.json`.
 *
 *   HERMES_BUNDLE_ID     the iOS bundle identifier and the Android package
 *   HERMES_APP_NAME      the name under the icon
 *   HERMES_APP_VERSION   the version a person reads ("2.0")
 *   HERMES_BUILD_NUMBER  the build number of this upload ("20")
 *   HERMES_APPLE_TEAM    the Apple developer team that signs the build
 *   HERMES_PUSH_MODE     "production" for a TestFlight or App Store build
 */
module.exports = ({ config }) => {
  const env = process.env
  const id = env.HERMES_BUNDLE_ID || config.ios.bundleIdentifier

  return {
    ...config,
    name: env.HERMES_APP_NAME || config.name,
    version: env.HERMES_APP_VERSION || config.version,
    ios: {
      ...config.ios,
      bundleIdentifier: id,
      ...(env.HERMES_BUILD_NUMBER ? { buildNumber: env.HERMES_BUILD_NUMBER } : {}),
      ...(env.HERMES_APPLE_TEAM ? { appleTeamId: env.HERMES_APPLE_TEAM } : {})
    },
    android: { ...config.android, package: env.HERMES_BUNDLE_ID ? id.replace(/-/g, '_') : config.android.package },
    plugins: config.plugins.map(plugin =>
      plugin === 'expo-notifications' && env.HERMES_PUSH_MODE ? ['expo-notifications', { mode: env.HERMES_PUSH_MODE }] : plugin
    )
  }
}
