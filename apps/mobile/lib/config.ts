import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { normalizeServerUrl, resolveApiUrl } from './resolve-api-url';

/**
 * Where the app sends its requests.
 *
 * Resolution order, in `resolve-api-url.ts`:
 *   1. an address the student saved on the sign-in screen
 *   2. EXPO_PUBLIC_SANAD_API_URL, baked in at build time
 *   3. `expo.extra.apiUrl` in app.json, if a build pins one
 *   4. the machine Metro is served from — the machine `pnpm dev` runs on
 *   5. a platform-appropriate loopback
 *
 * Step 4 is what makes Expo Go work with no configuration. Step 1 is what makes
 * an installed APK work: there is no Metro in a standalone build, and a laptop's
 * LAN address is not stable, so the address has to be changeable on the phone.
 *
 * This is deliberately mutable state rather than a constant. `initApiUrl` runs
 * before the first screen, so no request is ever sent to a stale address.
 */

const SERVER_KEY = 'sanad.server.url';

function metroHost(): string | null {
  // `debuggerHost` is the older field; still present in SDK 52.
  const config = Constants.expoConfig as { hostUri?: string } | null;
  const goConfig = Constants.expoGoConfig as { debuggerHost?: string } | null | undefined;
  return config?.hostUri ?? goConfig?.debuggerHost ?? null;
}

/** What the app would use with nothing saved — shown as the placeholder. */
export function detectedApiUrl(): string {
  return resolveApiUrl({
    envUrl: process.env.EXPO_PUBLIC_SANAD_API_URL,
    configuredUrl: (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl,
    hostUri: metroHost(),
    platform: Platform.OS,
  });
}

let current = detectedApiUrl();
let saved: string | null = null;

/**
 * True when the app has no way to know where the server is: an installed build
 * (no Metro to ask) with nothing saved yet. The sign-in screen opens the address
 * field in that case, because the alternative is a student staring at a loopback
 * address that can never work on a phone.
 */
export function needsServerAddress(): boolean {
  return saved === null && metroHost() === null;
}

export function getApiUrl(): string {
  return current;
}

/** Reads the saved address, if any. Call once, before the first screen renders. */
export async function initApiUrl(): Promise<string> {
  saved = await AsyncStorage.getItem(SERVER_KEY);
  current = resolveApiUrl({
    savedUrl: saved,
    envUrl: process.env.EXPO_PUBLIC_SANAD_API_URL,
    configuredUrl: (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl,
    hostUri: metroHost(),
    platform: Platform.OS,
  });
  return current;
}

/**
 * Saves an address typed on the phone. Returns the normalized form, or null if
 * the input cannot be a host — the caller says so rather than storing something
 * that fails later with a less obvious error.
 */
export async function setApiUrl(input: string): Promise<string | null> {
  const normalized = normalizeServerUrl(input);
  if (!normalized) return null;
  await AsyncStorage.setItem(SERVER_KEY, normalized);
  saved = normalized;
  current = normalized;
  return normalized;
}

/** Forgets the saved address and goes back to whatever the build detects. */
export async function clearApiUrl(): Promise<string> {
  await AsyncStorage.removeItem(SERVER_KEY);
  saved = null;
  current = detectedApiUrl();
  return current;
}

export const CONFIG = {
  /** How often the queue looks for work while the app is open. */
  drainIntervalMs: 20_000,
};
