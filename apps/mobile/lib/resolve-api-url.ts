/**
 * Where the mobile app should send its requests.
 *
 * This is separated from `config.ts` so it can be tested without a React Native
 * runtime: everything here is a pure function of values the caller reads from
 * Expo and the platform.
 *
 * The hard part is that "the server" means a different address depending on who
 * is asking. A phone running Expo Go has its own `localhost`, so a hardcoded
 * `http://localhost:3000` reaches the phone itself and every request fails with
 * a connection error that looks like the server is down. An Android emulator
 * cannot reach the host's loopback either, and needs the 10.0.2.2 alias.
 *
 * Metro already knows the answer: it told the device its own address in order
 * to serve the bundle, and the web app runs on that same machine. Deriving the
 * API host from Metro's is what makes `pnpm dev` + `pnpm mobile` work on a real
 * phone with no configuration at all.
 */

/** The port the web app listens on. Matches `pnpm dev`. */
export const API_PORT = 3000;

export interface ApiUrlSources {
  /**
   * What the student typed on the sign-in screen and the app remembered.
   *
   * Highest precedence, and the reason an installed APK is usable at all: a
   * standalone build has no Metro to ask, and a laptop's LAN address changes
   * whenever the router feels like it. Someone holding the phone can fix that
   * without a rebuild.
   */
  savedUrl?: string | null;
  /** EXPO_PUBLIC_SANAD_API_URL — an explicit override, for LAN or production. */
  envUrl?: string | null;
  /** `expo.extra.apiUrl` in app.json, if a build pins one. */
  configuredUrl?: string | null;
  /** Metro's own address, e.g. "192.168.1.5:8081" or "exp://192.168.1.5:8081". */
  hostUri?: string | null;
  /** `Platform.OS`. */
  platform?: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Android emulators reach the host machine through this alias, not loopback. */
const ANDROID_EMULATOR_HOST = '10.0.2.2';

export function resolveApiUrl(sources: ApiUrlSources): string {
  const explicit = firstNonEmpty(sources.savedUrl, sources.envUrl, sources.configuredUrl);
  if (explicit) return trimTrailingSlash(explicit);

  const host = hostFromUri(sources.hostUri);
  if (host) return `http://${loopbackAlias(host, sources.platform)}:${API_PORT}`;

  return `http://${loopbackAlias('localhost', sources.platform)}:${API_PORT}`;
}

/**
 * Pulls the bare host out of whatever shape Expo hands over: "192.168.1.5:8081",
 * "exp://192.168.1.5:8081", "http://10.0.0.4:8081/index.bundle". The port is
 * Metro's and is deliberately discarded — only the machine matters.
 */
function hostFromUri(uri: string | null | undefined): string | null {
  const value = uri?.trim();
  if (!value) return null;

  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const withoutPath = withoutScheme.split('/')[0] ?? '';
  if (!withoutPath) return null;

  // Bracketed IPv6 keeps its brackets; everything else splits on the port colon.
  const host = withoutPath.startsWith('[')
    ? (withoutPath.match(/^\[[^\]]*\]/)?.[0] ?? null)
    : (withoutPath.split(':')[0] ?? null);

  return host && host.length > 0 ? host : null;
}

/**
 * A loopback host is the one answer that is never right on Android: the emulator
 * needs 10.0.2.2, and a physical device pointed at its own loopback cannot reach
 * anything. Substituting keeps the emulator working; a physical device in that
 * situation has no derivable answer and needs the env override.
 */
function loopbackAlias(host: string, platform: string | undefined): string {
  if (platform === 'android' && LOOPBACK.has(host.toLowerCase())) return ANDROID_EMULATOR_HOST;
  return host;
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** `${API_URL}${path}` is how every call is built, and path already leads with `/`. */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Turns what someone types into a base URL.
 *
 * Students type "192.168.1.5", not "http://192.168.1.5:3000". A bare host is
 * completed with http and the dev port; anything carrying a scheme is respected
 * exactly as written, so a deployed https backend is never rewritten.
 *
 * Returns null for input that cannot be a host, so the caller can say so rather
 * than storing something that will fail later with a confusing error.
 */
export function normalizeServerUrl(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;

  // Read the host before trimming: trimming "http://" first would leave "http:",
  // which then parses as a host and stores an address nothing can be fetched from.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return hostFromUri(value) ? trimTrailingSlash(value) : null;
  }

  const withoutPath = trimTrailingSlash(value).split('/')[0] ?? '';
  const host = hostFromUri(withoutPath);
  if (!host) return null;

  // Whatever follows the host must be a usable port or nothing at all. Silently
  // discarding a typed ":8O80" would hand back an address that looks accepted
  // and is not the one they asked for.
  const rest = withoutPath.slice(host.length);
  if (rest === '') return `http://${host}:${API_PORT}`;

  const port = rest.match(/^:(\d{1,5})$/)?.[1];
  if (!port || Number(port) < 1 || Number(port) > 65535) return null;
  return `http://${host}:${port}`;
}
