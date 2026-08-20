/**
 * Incremental SHA-256.
 *
 * The server verifies the checksum of every completed upload against the bytes
 * it received, so the device has to produce the *same* digest — of the file's
 * raw bytes, computed without ever holding the whole file in memory. A phone
 * cannot load an hour-long recording at once, and Expo's crypto module hashes
 * only whole strings or whole buffers, so neither of the obvious routes works.
 *
 * Hence this: a plain implementation with an `update`/`digest` pair the file
 * adapter can feed one window at a time. It is platform-agnostic on purpose, so
 * `tests/integration/offline-queue.test.ts` can check it against `node:crypto`
 * rather than the correctness of every upload resting on a simulator run.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

export class Sha256 {
  private readonly h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockLength = 0;
  private byteCount = 0;
  private finished = false;

  update(bytes: Uint8Array): this {
    if (this.finished) throw new Error('This digest has already been finalized.');
    this.byteCount += bytes.length;

    let offset = 0;
    if (this.blockLength > 0) {
      const take = Math.min(64 - this.blockLength, bytes.length);
      this.block.set(bytes.subarray(0, take), this.blockLength);
      this.blockLength += take;
      offset = take;
      if (this.blockLength === 64) {
        this.compress(this.block, 0);
        this.blockLength = 0;
      }
    }

    while (offset + 64 <= bytes.length) {
      this.compress(bytes, offset);
      offset += 64;
    }

    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), 0);
      this.blockLength = bytes.length - offset;
    }
    return this;
  }

  /** Lowercase hex, matching what the server compares against. */
  digest(): string {
    if (!this.finished) {
      // Padding: a single 1 bit, zeroes, then the message length in bits as a
      // 64-bit big-endian integer.
      const tail = new Uint8Array(this.blockLength < 56 ? 64 : 128);
      tail.set(this.block.subarray(0, this.blockLength), 0);
      tail[this.blockLength] = 0x80;

      const bits = this.byteCount * 8;
      const high = Math.floor(bits / 0x100000000);
      const low = bits >>> 0;
      const view = new DataView(tail.buffer);
      view.setUint32(tail.length - 8, high, false);
      view.setUint32(tail.length - 4, low, false);

      for (let offset = 0; offset < tail.length; offset += 64) this.compress(tail, offset);
      this.finished = true;
    }

    let hex = '';
    for (const word of this.h) hex += word.toString(16).padStart(8, '0');
    return hex;
  }

  private compress(bytes: Uint8Array, offset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      w[i] =
        ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = this.h as unknown as number[] as [
      number, number, number, number, number, number, number, number,
    ];

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h[0] = (this.h[0]! + a) >>> 0;
    this.h[1] = (this.h[1]! + b) >>> 0;
    this.h[2] = (this.h[2]! + c) >>> 0;
    this.h[3] = (this.h[3]! + d) >>> 0;
    this.h[4] = (this.h[4]! + e) >>> 0;
    this.h[5] = (this.h[5]! + f) >>> 0;
    this.h[6] = (this.h[6]! + g) >>> 0;
    this.h[7] = (this.h[7]! + h) >>> 0;
  }
}

/** Convenience for a value that already fits in memory. */
export function sha256Hex(bytes: Uint8Array): string {
  return new Sha256().update(bytes).digest();
}

/** Decodes standard base64 without depending on Buffer or atob. */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[\n\r=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let accumulator = 0;
  let bits = 0;
  let written = 0;

  for (let i = 0; i < clean.length; i += 1) {
    const value = BASE64_LOOKUP[clean.charCodeAt(i)]!;
    if (value === 255) throw new Error('The recording data is not valid base64.');
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }
  return out.subarray(0, written);
}
