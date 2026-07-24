/**
 * Minimal BLAKE2b-512 implementation for the browser.
 *
 * Pure JavaScript, no dependencies. Used by the Noise IK handshake
 * in the Stratum V2 mining client.
 *
 * Based on RFC 7693 with the BLAKE2b specification (64-byte output,
 * 128-byte block size).
 */

// BLAKE2b-512 IV (first 64 bits of fractional parts of sqrt primes)
const IV = new Uint32Array([
  0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b,
  0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
  0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f,
  0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
]);

// Sigma permutation table for 12 rounds
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

const BLOCK_BYTES = 128;
const OUT_BYTES = 64;

function G(
  v: Uint32Array, a: number, b: number, c: number, d: number,
  x: number, y: number
): void {
  // Use >>>0 for unsigned 32-bit
  v[a] = (v[a] + v[b] + x) >>> 0;
  v[d] = ((v[d] ^ v[a]) >>> 16) | ((v[d] ^ v[a]) << 16) >>> 0; // rotr 32-16=16
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = ((v[b] ^ v[c]) >>> 20) | ((v[b] ^ v[c]) << 12) >>> 0; // rotr 32-20=12
  v[a] = (v[a] + v[b] + y) >>> 0;
  v[d] = ((v[d] ^ v[a]) >>> 24) | ((v[d] ^ v[a]) << 8) >>> 0; // rotr 32-24=8
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = ((v[b] ^ v[c]) >>> 31) | ((v[b] ^ v[c]) << 1) >>> 0; // rotr 31
}

function compress(
  h: Uint32Array,
  block: Uint32Array,
  t0: number, t1: number,
  last: boolean
): void {
  const v = new Uint32Array(16);
  for (let i = 0; i < 8; i++) v[i] = h[i];
  for (let i = 0; i < 8; i++) v[i + 8] = IV[i];

  v[12] ^= t0;
  v[13] ^= t1;
  if (last) v[14] = ~v[14];

  for (let r = 0; r < 12; r++) {
    const s = SIGMA[r];
    G(v, 0, 4, 8, 12, block[s[0]], block[s[1]]);
    G(v, 1, 5, 9, 13, block[s[2]], block[s[3]]);
    G(v, 2, 6, 10, 14, block[s[4]], block[s[5]]);
    G(v, 3, 7, 11, 15, block[s[6]], block[s[7]]);
    G(v, 0, 5, 10, 15, block[s[8]], block[s[9]]);
    G(v, 1, 6, 11, 12, block[s[10]], block[s[11]]);
    G(v, 2, 7, 8, 13, block[s[12]], block[s[13]]);
    G(v, 3, 4, 9, 14, block[s[14]], block[s[15]]);
  }

  for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
}

function bytesToWordsLE(data: Uint8Array, offset: number, words: Uint32Array): void {
  for (let i = 0; i < 16; i++) {
    const o = offset + i * 4;
    words[i] =
      (data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) >>> 0;
  }
}

function wordsToBytesLE(state: Uint32Array, out: Uint8Array): void {
  for (let i = 0; i < 8; i++) {
    const v = state[i];
    out[i * 4] = v & 0xff;
    out[i * 4 + 1] = (v >>> 8) & 0xff;
    out[i * 4 + 2] = (v >>> 16) & 0xff;
    out[i * 4 + 3] = (v >>> 24) & 0xff;
  }
}

/**
 * Compute BLAKE2b-512 hash of the input data.
 */
export function blake2b512(data: Uint8Array): Uint8Array {
  const h = new Uint32Array(8);
  for (let i = 0; i < 8; i++) h[i] = IV[i];
  h[0] ^= 0x01010000 ^ OUT_BYTES; // param block: digest size + key length + fanout + depth

  const block = new Uint32Array(16);
  let offset = 0;
  let t0 = 0, t1 = 0;

  while (offset + BLOCK_BYTES <= data.length) {
    bytesToWordsLE(data, offset, block);
    t0 = (t0 + BLOCK_BYTES) >>> 0;
    if (t0 < BLOCK_BYTES) t1 = (t1 + 1) >>> 0;
    compress(h, block, t0, t1, false);
    offset += BLOCK_BYTES;
  }

  // Last block
  const remaining = data.length - offset;
  const lastBlock = new Uint8Array(BLOCK_BYTES);
  lastBlock.set(data.subarray(offset, offset + remaining));
  bytesToWordsLE(lastBlock, 0, block);
  t0 = (t0 + remaining) >>> 0;
  if (t0 < remaining) t1 = (t1 + 1) >>> 0;
  compress(h, block, t0, t1, true);

  const out = new Uint8Array(OUT_BYTES);
  wordsToBytesLE(h, out);
  return out;
}
