import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system';
import { Sha256, base64ToBytes, type FileAdapter, type NetworkAdapter, type QueueStorage } from '@sanad/offline';

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

const READ_WINDOW_BYTES = 1024 * 1024;

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
    // The server compares this against SHA-256 of the bytes it received, so it
    // has to be exactly that — streamed a window at a time, because an
    // hour-long recording cannot be held in memory on a phone. expo-crypto
    // hashes whole strings only, which is why the digest is incremental here.
    const size = await this.size(uri);
    const digest = new Sha256();
    for (let offset = 0; offset < size; offset += READ_WINDOW_BYTES) {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: offset,
        length: Math.min(READ_WINDOW_BYTES, size - offset),
      });
      digest.update(base64ToBytes(base64));
    }
    return digest.digest();
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
