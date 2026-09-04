import { describe, expect, it } from 'vitest';
import { API_PORT, normalizeServerUrl, resolveApiUrl } from '../../apps/mobile/lib/resolve-api-url';

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

  it('lets an address saved on the phone beat everything, which is what an APK needs', () => {
    expect(
      resolveApiUrl({
        savedUrl: 'http://192.168.1.9:3000',
        envUrl: 'https://baked-in.example.edu',
        hostUri: '192.168.1.5:8081',
        platform: 'android',
      }),
    ).toBe('http://192.168.1.9:3000');
  });

  it('keeps IPv6 brackets intact', () => {
    expect(resolveApiUrl({ hostUri: 'http://[fe80::1]:8081', platform: 'android' })).toBe(
      `http://[fe80::1]:${API_PORT}`,
    );
  });
});

/**
 * What someone types on a phone keyboard, standing in front of a laptop.
 */
describe('normalizeServerUrl', () => {
  it('completes a bare host with http and the dev port', () => {
    expect(normalizeServerUrl('192.168.1.5')).toBe(`http://192.168.1.5:${API_PORT}`);
    expect(normalizeServerUrl('  192.168.1.5  ')).toBe(`http://192.168.1.5:${API_PORT}`);
  });

  it('keeps a port that was typed', () => {
    expect(normalizeServerUrl('192.168.1.5:4000')).toBe('http://192.168.1.5:4000');
  });

  it('respects a scheme exactly, so a deployed https backend is not rewritten', () => {
    expect(normalizeServerUrl('https://sanad.example.edu')).toBe('https://sanad.example.edu');
    expect(normalizeServerUrl('https://sanad.example.edu/')).toBe('https://sanad.example.edu');
    expect(normalizeServerUrl('http://192.168.1.5:3000')).toBe('http://192.168.1.5:3000');
  });

  it('accepts a hostname, not only an address', () => {
    expect(normalizeServerUrl('my-laptop.local')).toBe(`http://my-laptop.local:${API_PORT}`);
  });

  it('rejects a port that is not a port, rather than quietly dropping it', () => {
    expect(normalizeServerUrl('192.168.1.5:8O80')).toBeNull();
    expect(normalizeServerUrl('192.168.1.5:0')).toBeNull();
    expect(normalizeServerUrl('192.168.1.5:99999')).toBeNull();
    expect(normalizeServerUrl('192.168.1.5:8080')).toBe('http://192.168.1.5:8080');
  });

  it('rejects what cannot be a host rather than saving it to fail later', () => {
    for (const bad of ['', '   ', 'not a host', 'http://', 'http://:3000', '://x']) {
      expect(normalizeServerUrl(bad)).toBeNull();
    }
  });
});
