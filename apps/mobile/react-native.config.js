/**
 * Corrects one autolinking entry for the native Android build.
 *
 * Autolinking guesses `expo`'s package import from the Gradle namespace in
 * `expo/android/build.gradle`, which is `expo.core` — but the class it needs is
 * `expo.modules.ExpoModulesPackage`. The package's own `react-native.config.js`
 * says so correctly and is not consulted here, so the generated `PackageList.java`
 * imports a class that does not exist and `:app:compileReleaseJavaWithJavac`
 * fails.
 *
 * Expo Go never sees this: it ships prebuilt native code, so no PackageList is
 * generated and nothing is compiled.
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: 'import expo.modules.ExpoModulesPackage;',
          packageInstance: 'new ExpoModulesPackage()',
        },
      },
    },
  },
};
