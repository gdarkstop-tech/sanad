const { createRequire } = require('node:module');

/**
 * Limits the APK to the ABIs named in SANAD_APK_ABIS.
 *
 * A universal APK carries native libraries for all four Android ABIs and is the
 * right default: it installs on anything. But three of those four are dead
 * weight on any given phone, and the resulting file is large enough to be
 * awkward to send. Setting SANAD_APK_ABIS=arm64-v8a — every Android phone since
 * roughly 2015 — drops the other three.
 *
 * Unset, this plugin does nothing and the build stays universal.
 *
 * `reactNativeArchitectures` in gradle.properties does not do this on its own:
 * it governs what React Native compiles, and these libraries arrive prebuilt
 * inside AARs, so they are packaged regardless.
 */

// pnpm's strict layout keeps @expo/config-plugins out of this package's reach;
// it belongs to expo, so resolve it the way expo would.
const fromExpo = createRequire(require.resolve('expo/package.json'));
const { withAppBuildGradle } = fromExpo('@expo/config-plugins');

module.exports = function withAbiFilter(config) {
  const abis = (process.env.SANAD_APK_ABIS ?? '')
    .split(',')
    .map((abi) => abi.trim())
    .filter(Boolean);
  if (abis.length === 0) return config;

  return withAppBuildGradle(config, (modConfig) => {
    const list = abis.map((abi) => `'${abi}'`).join(', ');
    const block = `        ndk {\n            abiFilters ${list}\n        }\n`;
    // Anchor on versionName, the last line of defaultConfig that the template
    // always emits, so the insert does not depend on formatting elsewhere.
    const anchor = /^(\s*versionName ".*"\s*)$/m;
    if (!anchor.test(modConfig.modResults.contents)) {
      throw new Error('with-abi-filter: could not find versionName in app/build.gradle');
    }
    modConfig.modResults.contents = modConfig.modResults.contents.replace(
      anchor,
      `$1\n${block}`,
    );
    return modConfig;
  });
};
