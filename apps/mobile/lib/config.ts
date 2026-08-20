import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * API base URL.
 *
 * Resolution order lets one build serve every situation without editing code:
 *   1. EXPO_PUBLIC_SANAD_API_URL — set it in .env for LAN or production
 *   2. the `apiUrl` value in app.json
 *   3. a platform-appropriate localhost default
 *
 * Android emulators cannot reach the host's `localhost`; 10.0.2.2 is the
 * loopback alias that reaches it, which is the single most common reason a
 * mobile client "cannot connect" to a working dev server.
 */
function defaultUrl(): string {
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000';
  return 'http://localhost:3000';
}

export const API_URL: string =
  process.env.EXPO_PUBLIC_SANAD_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  defaultUrl();

export const CONFIG = {
  apiUrl: API_URL,
  /** How often the queue looks for work while the app is open. */
  drainIntervalMs: 20_000,
};
