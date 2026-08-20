import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import type { FileAdapter, NetworkAdapter, QueueStorage } from '@sanad/offline';

/**
 * Native adapters for the offline queue.
 *
 * The queue's logic is platform-agnostic and tested in Node; these supply the
 * device-specific halves. Keeping the split means a bug in the queue is caught
 * by a unit test rather than only on a phone.
 */

export const storageAdapter: QueueStorage = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
  keys: async () => [...(await AsyncStorage.getAllKeys())],
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const fileAdapter: FileAdapter = {
  async exists(uri) {
    return (await FileSystem.getInfoAsync(uri)).exists;
  },
  async size(uri) {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return info.exists && 'size' in info ? (info.size ?? 0) : 0;
  },
  async readChunk(uri, offset, length) {
    // Read a window rather than the whole file: a long lecture must never be
    // loaded into memory in one piece on a phone.
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: offset,
      length,
    });
    return base64ToBytes(base64);
  },
  async sha256(uri) {
    // Streamed in windows for the same reason.
    const size = await this.size(uri);
    const window = 1024 * 1024;
    let accumulated = '';
    for (let offset = 0; offset < size; offset += window) {
      const part = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: offset,
        length: Math.min(window, size - offset),
      });
      accumulated = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        accumulated + part,
      );
    }
    return accumulated || (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, ''));
  },
  async remove(uri) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  },
};

export const networkAdapter: NetworkAdapter = {
  async isOnline() {
    const state = await NetInfo.fetch();
    // `isInternetReachable` can be null while unknown; treat connected as
    // online rather than blocking uploads on an uncertain signal.
    return Boolean(state.isConnected) && state.isInternetReachable !== false;
  },
  onChange(listener) {
    return NetInfo.addEventListener((state) => {
      listener(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
  },
};

export const recordingsDirectory = `${FileSystem.documentDirectory}sanad-recordings/`;

export async function ensureRecordingsDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(recordingsDirectory);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(recordingsDirectory, { intermediates: true });
  }
}
