/**
 * HSMC Mobile — Pure-JS Cryptographic Primitives
 *
 * React Native's Hermes engine does not ship WebCrypto (crypto.subtle), so every
 * primitive used by the wallet (SHA-256, SHA-512, HMAC, PBKDF2, AES-256-GCM)
 * is implemented here in dependency-free TypeScript. All implementations follow
 * the public specifications (FIPS 180-4, RFC 2104, RFC 2898, NIST SP 800-38D).
 * Cross-checked against Node.js WebCrypto during development; the mobile
 * __tests__/ suite is currently empty, so add vector tests there before relying
 * on this module for mainnet funds.
 *
 * No third-party crypto dependency is required — this runs anywhere.
 */

// ─── UTF-8 helpers (TextEncoder/TextDecoder fallback) ──────────────────────

/** Encode a JS string into UTF-8 bytes. */
export function utf8Encode(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  // Manual UTF-8 encoder fallback (no TextEncoder in very old Hermes builds).
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.codePointAt(i)!;
    if (code > 0xffff) {
      i++; // surrogate pair consumed
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
}

/** Decode UTF-8 bytes into a JS string. */
export function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let code: number;
    let extra: number;
    if (b < 0x80) {
      code = b;
      extra = 0;
    } else if ((b & 0xe0) === 0xc0) {
      code = b & 0x1f;
      extra = 1;
    } else if ((b & 0xf0) === 0xe0) {
      code = b & 0x0f;
      extra = 2;
    } else {
      code = b & 0x07;
      extra = 3;
    }
    for (let j = 1; j <= extra; j++) {
      code = (code << 6) | (bytes[i + j] & 0x3f);
    }
    i += extra + 1;
    out += String.fromCodePoint(code);
  }
  return out;
}

// ─── Secure random bytes ────────────────────────────────────────────────────

/**
 * Cryptographically secure random bytes. Uses the platform CSPRNG
 * (crypto.getRandomValues, which React Native ≥ 0.73 polyfills) and throws
 * a clear error if it is unavailable — Math.random is NEVER used for secrets.
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!g || typeof g.getRandomValues !== 'function') {
    throw new Error('Secure random source unavailable on this platform');
  }
  g.getRandomValues(bytes);
  return bytes;
}

// ─── SHA-256 (FIPS 180-4) ───────────────────────────────────────────────────

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr32 = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

/** SHA-256 digest. Returns 32 bytes. */
export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 8) >> 6 << 6) + 64);
  padded.set(data, 0);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const m = new DataView(padded.buffer);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = m.getUint32(off + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
  return out;
}

// ─── SHA-512 (FIPS 180-4) — BigInt based ────────────────────────────────────

const SHA512_K: bigint[] = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

const MASK64 = (1n << 64n) - 1n;
const rotr64 = (x: bigint, n: number): bigint => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK64;

/** SHA-512 digest. Returns 64 bytes. */
export function sha512(data: Uint8Array): Uint8Array {
  const h = [
    0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
  ];
  const w = new Array<bigint>(80);
  const bitLen = data.length * 8;
  const paddedLen = ((data.length + 16) >> 7 << 7) + 128;
  const padded = new Uint8Array(paddedLen);
  padded.set(data, 0);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  // 128-bit big-endian length: high 64 bits (zero) then low 64 bits in the LAST 8 bytes
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);

  for (let off = 0; off < padded.length; off += 128) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getBigUint64(off + i * 8);
    }
    for (let i = 16; i < 80; i++) {
      const s0 = rotr64(w[i - 15], 1) ^ rotr64(w[i - 15], 8) ^ (w[i - 15] >> 7n);
      const s1 = rotr64(w[i - 2], 19) ^ rotr64(w[i - 2], 61) ^ (w[i - 2] >> 6n);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA512_K[i] + w[i]) & MASK64;
      const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & MASK64;
      hh = g; g = f; f = e; e = (d + t1) & MASK64;
      d = c; c = b; b = a; a = (t1 + t2) & MASK64;
    }
    h[0] = (h[0] + a) & MASK64; h[1] = (h[1] + b) & MASK64; h[2] = (h[2] + c) & MASK64; h[3] = (h[3] + d) & MASK64;
    h[4] = (h[4] + e) & MASK64; h[5] = (h[5] + f) & MASK64; h[6] = (h[6] + g) & MASK64; h[7] = (h[7] + hh) & MASK64;
  }
  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setBigUint64(i * 8, h[i]);
  return out;
}

// ─── HMAC (RFC 2104) ────────────────────────────────────────────────────────

type HashFn = (data: Uint8Array) => Uint8Array;

function hmac(hash: HashFn, blockSize: number, key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key;
  if (k.length > blockSize) {
    k = hash(k);
  }
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  ipad.set(k, 0);
  opad.set(k, 0);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] ^= 0x36;
    opad[i] ^= 0x5c;
  }
  const inner = new Uint8Array(blockSize + message.length);
  inner.set(ipad, 0);
  inner.set(message, blockSize);
  const innerHash = hash(inner);
  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(opad, 0);
  outer.set(innerHash, blockSize);
  return hash(outer);
}

/** HMAC-SHA-256. Returns 32 bytes. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha256, 64, key, message);
}

/** HMAC-SHA-512. Returns 64 bytes. */
export function hmacSha512(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha512, 128, key, message);
}

// ─── PBKDF2 (RFC 2898) ──────────────────────────────────────────────────────

function pbkdf2(
  hmacFn: (key: Uint8Array, msg: Uint8Array) => Uint8Array,
  hashLen: number,
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyLen: number
): Uint8Array {
  const blocks = Math.ceil(keyLen / hashLen);
  const out = new Uint8Array(blocks * hashLen);
  const saltBlock = new Uint8Array(salt.length + 4);
  saltBlock.set(salt, 0);
  const u = new Uint8Array(hashLen);
  for (let block = 1; block <= blocks; block++) {
    const dv = new DataView(saltBlock.buffer);
    dv.setUint32(salt.length, block);
    let uPrev = hmacFn(password, saltBlock);
    u.set(uPrev, 0);
    for (let i = 1; i < iterations; i++) {
      uPrev = hmacFn(password, uPrev);
      for (let j = 0; j < hashLen; j++) u[j] ^= uPrev[j];
    }
    out.set(u, (block - 1) * hashLen);
  }
  return out.slice(0, keyLen);
}

/** PBKDF2-HMAC-SHA-256 (used for password hardening). */
export function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyLen: number
): Uint8Array {
  return pbkdf2(hmacSha256, 32, password, salt, iterations, keyLen);
}

/** PBKDF2-HMAC-SHA-512 (BIP39 seed derivation, 2048 iterations). */
export function pbkdf2Sha512(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyLen: number
): Uint8Array {
  return pbkdf2(hmacSha512, 64, password, salt, iterations, keyLen);
}

// ─── AES-256-GCM (NIST SP 800-38D) ──────────────────────────────────────────

// Generate AES S-box and inverse S-box from GF(2^8) arithmetic at load time.
const AES_SBOX = new Uint8Array(256);
const AES_INV_SBOX = new Uint8Array(256);
const AES_GF_EXP = new Uint8Array(510);
const AES_GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    AES_GF_EXP[i] = x;
    AES_GF_LOG[x] = i;
    x ^= (x << 1) ^ ((x & 0x80) ? 0x1b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 510; i++) AES_GF_EXP[i] = AES_GF_EXP[i - 255];
  for (let i = 0; i < 256; i++) {
    let s = i === 0 ? 0 : AES_GF_EXP[255 - AES_GF_LOG[i]];
    s = s ^ rotl8(s, 1) ^ rotl8(s, 2) ^ rotl8(s, 3) ^ rotl8(s, 4) ^ 0x63;
    AES_SBOX[i] = s;
    AES_INV_SBOX[s] = i;
  }
}

function rotl8(x: number, n: number): number {
  return ((x << n) | (x >>> (8 - n))) & 0xff;
}

function xtime(a: number): number {
  a &= 0xff;
  return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff;
}

/** Expand a 32-byte key into 240 round-key bytes (Nk=8, Nr=14). */
function aesKeyExpansion(key: Uint8Array): Uint8Array {
  const nk = 8;
  const nr = 14;
  const w = new Uint8Array(4 * 4 * (nr + 1));
  for (let i = 0; i < 4 * nk; i++) w[i] = key[i];
  let rcon = 1;
  for (let i = nk; i < 4 * (nr + 1); i++) {
    const temp = [w[(i - 1) * 4], w[(i - 1) * 4 + 1], w[(i - 1) * 4 + 2], w[(i - 1) * 4 + 3]];
    if (i % nk === 0) {
      // RotWord([a,b,c,d]) = [b,c,d,a], then SubWord each byte, then temp[0] ^= Rcon
      const rot = [temp[1], temp[2], temp[3], temp[0]];
      temp[0] = AES_SBOX[rot[0]] ^ rcon;
      temp[1] = AES_SBOX[rot[1]];
      temp[2] = AES_SBOX[rot[2]];
      temp[3] = AES_SBOX[rot[3]];
      rcon = xtime(rcon);
    } else if (nk > 6 && i % nk === 4) {
      for (let j = 0; j < 4; j++) temp[j] = AES_SBOX[temp[j]];
    }
    for (let j = 0; j < 4; j++) {
      w[i * 4 + j] = w[(i - nk) * 4 + j] ^ temp[j];
    }
  }
  return w;
}

function aesEncryptBlock(state: Uint8Array, roundKey: Uint8Array, nr: number): Uint8Array {
  const s = new Uint8Array(16);
  for (let i = 0; i < 16; i++) s[i] = state[i] ^ roundKey[i];
  for (let round = 1; round <= nr; round++) {
    // SubBytes + ShiftRows (column-major state: s[c*4+r] = state[r][c])
    // ShiftRows: new[r][c] = old[r][(c+r) % 4]
    const t = new Uint8Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        t[c * 4 + r] = AES_SBOX[s[((r + c) % 4) * 4 + r]];
      }
    }
    if (round < nr) {
      // MixColumns
      for (let c = 0; c < 4; c++) {
        const a0 = t[c * 4], a1 = t[c * 4 + 1], a2 = t[c * 4 + 2], a3 = t[c * 4 + 3];
        t[c * 4] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
        t[c * 4 + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
        t[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
        t[c * 4 + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
      }
    }
    // AddRoundKey
    for (let i = 0; i < 16; i++) s[i] = t[i] ^ roundKey[round * 16 + i];
  }
  return s;
}

// ─── GCM internals ──────────────────────────────────────────────────────────

function gmul128(x: Uint8Array, y: Uint8Array): Uint8Array {
  const z = new Uint8Array(16);
  const v = new Uint8Array(y);
  for (let i = 0; i < 128; i++) {
    const bit = (x[i >> 3] >> (7 - (i & 7))) & 1;
    if (bit === 1) {
      for (let j = 0; j < 16; j++) z[j] ^= v[j];
    }
    const lsb = (v[15] & 1) === 1;
    for (let j = 15; j > 0; j--) {
      v[j] = ((v[j] >> 1) | ((v[j - 1] & 1) << 7)) & 0xff;
    }
    v[0] = (v[0] >> 1) & 0xff;
    if (lsb) v[0] = (v[0] ^ 0xe1) & 0xff;
  }
  return z;
}

function ghash(h: Uint8Array, data: Uint8Array): Uint8Array {
  const y = new Uint8Array(16);
  const block = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    for (let i = 0; i < 16; i++) {
      block[i] = off + i < data.length ? data[off + i] : 0;
    }
    for (let i = 0; i < 16; i++) y[i] ^= block[i];
    const prod = gmul128(y, h);
    y.set(prod, 0);
  }
  return y;
}

function gcmIncrement(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(block);
  for (let i = 15; i >= 12; i--) {
    out[i] = (out[i] + 1) & 0xff;
    if (out[i] !== 0) break;
  }
  return out;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * AES-256-GCM encrypt. key must be 32 bytes, iv 12 bytes.
 * Returns ciphertext || 16-byte authentication tag.
 */
export function aes256GcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  if (iv.length !== 12) throw new Error('GCM IV must be 12 bytes');
  const roundKey = aesKeyExpansion(key);
  const nr = 14;
  const h = aesEncryptBlock(new Uint8Array(16), roundKey, nr);

  // J0 = IV || 0^31 || 1
  const j0 = new Uint8Array(16);
  j0.set(iv, 0);
  j0[15] = 1;

  // CTR encryption
  const ct = new Uint8Array(plaintext.length);
  let counter = new Uint8Array(j0);
  for (let off = 0; off < plaintext.length; off += 16) {
    counter = gcmIncrement(counter);
    const ks = aesEncryptBlock(counter, roundKey, nr);
    for (let i = 0; i < 16 && off + i < plaintext.length; i++) {
      ct[off + i] = plaintext[off + i] ^ ks[i];
    }
  }

  // GHASH over A || C || 0^v || len(A)||len(C) where v pads A||C to a
  // 128-bit boundary (NIST SP 800-38D §6.4). AAD is empty here.
  const lenBlock = new Uint8Array(16);
  const dv = new DataView(lenBlock.buffer);
  dv.setBigUint64(0, 0n);
  dv.setBigUint64(8, BigInt(ct.length) * 8n);
  const padLen = (16 - (ct.length % 16)) % 16;
  const ghashInput = new Uint8Array(ct.length + padLen + 16);
  ghashInput.set(ct, 0);
  ghashInput.set(lenBlock, ct.length + padLen);
  const s = ghash(h, ghashInput);

  // Tag = S XOR E_K(J0)
  const eJ0 = aesEncryptBlock(j0, roundKey, nr);
  const tag = xorBytes(s, eJ0);

  const out = new Uint8Array(ct.length + 16);
  out.set(ct, 0);
  out.set(tag, ct.length);
  return out;
}

/**
 * AES-256-GCM decrypt. input must be ciphertext || 16-byte tag.
 * Throws on authentication failure (bad password / tampered data).
 */
export function aes256GcmDecrypt(key: Uint8Array, iv: Uint8Array, input: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  if (iv.length !== 12) throw new Error('GCM IV must be 12 bytes');
  if (input.length < 16) throw new Error('Ciphertext too short');
  const ct = input.slice(0, input.length - 16);
  const tag = input.slice(input.length - 16);

  const roundKey = aesKeyExpansion(key);
  const nr = 14;
  const h = aesEncryptBlock(new Uint8Array(16), roundKey, nr);

  const j0 = new Uint8Array(16);
  j0.set(iv, 0);
  j0[15] = 1;

  // Recompute GHASH (same input layout as encryption: pad C to block boundary)
  const lenBlock = new Uint8Array(16);
  const dv = new DataView(lenBlock.buffer);
  dv.setBigUint64(0, 0n);
  dv.setBigUint64(8, BigInt(ct.length) * 8n);
  const padLen = (16 - (ct.length % 16)) % 16;
  const ghashInput = new Uint8Array(ct.length + padLen + 16);
  ghashInput.set(ct, 0);
  ghashInput.set(lenBlock, ct.length + padLen);
  const s = ghash(h, ghashInput);
  const eJ0 = aesEncryptBlock(j0, roundKey, nr);
  const expectedTag = xorBytes(s, eJ0);

  let ok = tag.length === expectedTag.length;
  if (ok) {
    let acc = 0;
    for (let i = 0; i < tag.length; i++) acc |= tag[i] ^ expectedTag[i];
    ok = acc === 0;
  }
  if (!ok) {
    throw new Error('Authentication failed: incorrect password or corrupted data');
  }

  // CTR decrypt
  const pt = new Uint8Array(ct.length);
  let counter = new Uint8Array(j0);
  for (let off = 0; off < ct.length; off += 16) {
    counter = gcmIncrement(counter);
    const ks = aesEncryptBlock(counter, roundKey, nr);
    for (let i = 0; i < 16 && off + i < ct.length; i++) {
      pt[off + i] = ct[off + i] ^ ks[i];
    }
  }
  return pt;
}

// ─── Hex / Base64 helpers ───────────────────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'undefined') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  // Fallback: manual base64
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? chars[b2 & 63] : '=';
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s/g, '');
  if (typeof atob !== 'undefined') {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=') break;
    const val = chars.indexOf(c);
    if (val < 0) throw new Error('Invalid base64 character');
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
