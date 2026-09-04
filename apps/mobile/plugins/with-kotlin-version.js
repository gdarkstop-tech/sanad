const { createRequire } = require('node:module');

/**
 * Pins Kotlin to the version React Native actually builds with.
 *
 * Two things disagree by default in Expo SDK 52. React Native 0.76's version
 * catalog puts Kotlin 1.9.24 on the buildscript classpath, and that is what
 * compiles. Expo's template ext defaults to 1.9.25, and `expo-modules-core`
 * uses that number to pick its Compose compiler — 1.5.15, which refuses to run
 * against Kotlin 1.9.24. The native build fails at `:expo-modules-core:
 * compileReleaseKotlin` with a compatibility error naming both versions.
 *
 * Naming 1.9.24 makes the ext agree with what is on the classpath, so
 * expo-modules-core selects the matching Compose compiler (1.5.14) instead.
 *
 * Expo Go never hits this: it ships prebuilt native code, so nothing compiles.
 */

// pnpm's strict layout keeps @expo/config-plugins out of this package's reach;
// it belongs to expo, so resolve it the way expo would.
const fromExpo = createRequire(require.resolve('expo/package.json'));
const { withGradleProperties } = fromExpo('@expo/config-plugins');

/** React Native 0.76's `gradle/libs.versions.toml`. */
const KOTLIN_VERSION = '1.9.24';
const KEY = 'android.kotlinVersion';

module.exports = function withKotlinVersion(config) {
  return withGradleProperties(config, (modConfig) => {
    modConfig.modResults = modConfig.modResults.filter(
      (item) => !(item.type === 'property' && item.key === KEY),
    );
    modConfig.modResults.push({ type: 'property', key: KEY, value: KOTLIN_VERSION });
    return modConfig;
  });
};
