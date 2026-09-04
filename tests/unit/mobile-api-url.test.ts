import { describe, expect, it } from 'vitest';
import { API_PORT, resolveApiUrl } from '../../apps/mobile/lib/resolve-api-url';

/**
 * The mobile app's single most failure-prone value.
 *
 * A wrong answer here does not look like a configuration mistake to a student:
 * it looks like the whole server is down. These cases are the ones that actually
 * happen — Expo Go on a phone, an Android emulator, a pinned production build.
 */
describe('resolveApiUrl', () => {
  it('derives the LAN host from Metro, which is what makes a real phone work', () => {
    expect(resolveApiUrl({ hostUri: '192.168.1.5:8081', platform: 'android' })).toBe(
      `http://192.168.1.5:${API_PORT}`,
    );
  });

  it('accepts the scheme-and-path shapes Expo hands over', () => {
    for (const uri of [
      'exp://192.168.1.5:8081',
      'http://192.168.1.5:8081',
      'http://192.168.1.5:8081/index.bundle?platform=android',
      '192.168.1.5:8081',
    ]) {
      expect(resolveApiUrl({ hostUri: uri, platform: 'android' })).toBe(
        `http://192.168.1.5:${API_PORT}`,
      );
    }
  });

  it('substitutes the emulator alias when Metro reports loopback on Android', () => {
    expect(resolveApiUrl({ hostUri: 'localhost:8081', platform: 'android' })).toBe(
      `http://10.0.2.2:${API_PORT}`,
    );
    expect(resolveApiUrl({ hostUri: '127.0.0.1:8081', platform: 'android' })).toBe(
      `http://10.0.2.2:${API_PORT}`,
    );
  });

  it('leaves loopback alone off Android, where it is correct', () => {
    expect(resolveApiUrl({ hostUri: 'localhost:8081', platform: 'ios' })).toBe(
      `http://localhost:${API_PORT}`,
    );
  });

  it('falls back to a platform-appropriate loopback when Metro says nothing', () => {
    expect(resolveApiUrl({ platform: 'android' })).toBe(`http://10.0.2.2:${API_PORT}`);
    expect(resolveApiUrl({ platform: 'ios' })).toBe(`http://localhost:${API_PORT}`);
    expect(resolveApiUrl({})).toBe(`http://localhost:${API_PORT}`);
  });

  it('lets the environment override everything, for LAN or production', () => {
    expect(
      resolveApiUrl({
        envUrl: 'https://sanad.example.edu',
        configuredUrl: 'http://pinned:3000',
        hostUri: '192.168.1.5:8081',
        platform: 'android',
      }),
    ).toBe('https://sanad.example.edu');
  });

  it('prefers a pinned app.json value over the derived host', () => {
    expect(
      resolveApiUrl({
        configuredUrl: 'https://sanad.example.edu',
        hostUri: '192.168.1.5:8081',
        platform: 'android',
      }),
    ).toBe('https://sanad.example.edu');
  });

  it('ignores blank overrides rather than producing an empty base URL', () => {
    expect(
      resolveApiUrl({ envUrl: '   ', configuredUrl: '', hostUri: '192.168.1.5:8081' }),
    ).toBe(`http://192.168.1.5:${API_PORT}`);
  });

  it('trims the trailing slash, because every path already leads with one', () => {
    expect(resolveApiUrl({ envUrl: 'https://sanad.example.edu/' })).toBe(
      'https://sanad.example.edu',
    );
  });

  it('keeps IPv6 brackets intact', () => {
    expect(resolveApiUrl({ hostUri: 'http://[fe80::1]:8081', platform: 'android' })).toBe(
      `http://[fe80::1]:${API_PORT}`,
    );
  });
});
