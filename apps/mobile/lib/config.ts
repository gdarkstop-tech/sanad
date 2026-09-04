import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { resolveApiUrl } from './resolve-api-url';

/**
 * API base URL.
 *
 * Resolution order, in `resolve-api-url.ts`:
 *   1. EXPO_PUBLIC_SANAD_API_URL — set it in .env for LAN or production
 *   2. `expo.extra.apiUrl` in app.json, if a build pins one
 *   3. the machine Metro is served from, which is the machine `pnpm dev` runs on
 *   4. a platform-appropriate loopback
 *
 * Step 3 is what makes a real phone work with no configuration: Expo Go already
 * knows the host's LAN address because it downloaded the bundle from it.
 */

/** Set by Expo Go; `debuggerHost` is the older field, still present in SDK 52. */
function metroHost(): string | null {
  const config = Constants.expoConfig as { hostUri?: string } | null;
  const goConfig = Constants.expoGoConfig as { debuggerHost?: string } | null | undefined;
  return config?.hostUri ?? goConfig?.debuggerHost ?? null;
}

export const API_URL: string = resolveApiUrl({
  envUrl: process.env.EXPO_PUBLIC_SANAD_API_URL,
  configuredUrl: (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl,
  hostUri: metroHost(),
  platform: Platform.OS,
});

export const CONFIG = {
  apiUrl: API_URL,
  /** How often the queue looks for work while the app is open. */
  drainIntervalMs: 20_000,
};
