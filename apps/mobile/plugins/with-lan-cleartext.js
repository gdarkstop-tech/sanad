const { createRequire } = require('node:module');

/**
 * Lets the app talk to a Sanad server over plain HTTP.
 *
 * Android has blocked cleartext traffic by default since Android 9. Expo's
 * template re-enables it for debug builds only, which is right for an app that
 * talks to a public HTTPS backend — and wrong for this one. Sanad is run by the
 * student, on their own machine, on their own network: there is no domain, and
 * therefore no certificate anyone can issue for `192.168.1.5` at $0. Without
 * this, a release APK cannot reach the server at all, and fails in a way that
 * looks like the server is down.
 *
 * This is a real widening and worth naming: an installed build will send
 * requests in the clear to whatever address it is pointed at. Android's network
 * security config can restrict cleartext to named domains, but not to an address
 * range, so it cannot express "the local network" — which is the only thing this
 * app needs. A deployed HTTPS backend is unaffected: TLS is still used whenever
 * the address says https.
 */

// pnpm's strict layout keeps @expo/config-plugins out of this package's reach;
// it belongs to expo, so resolve it the way expo would.
const fromExpo = createRequire(require.resolve('expo/package.json'));
const { withAndroidManifest, AndroidConfig } = fromExpo('@expo/config-plugins');

module.exports = function withLanCleartext(config) {
  return withAndroidManifest(config, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$['android:usesCleartextTraffic'] = 'true';
    return modConfig;
  });
};
