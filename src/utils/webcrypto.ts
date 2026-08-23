/**
 * WebCrypto helper with a pure-JS fallback via @noble/hashes.
 *
 * The native Web Crypto API (`crypto.subtle`) is only available in SECURE
 * contexts (HTTPS, localhost). In insecure contexts — plain HTTP, some
 * WebViews, sandboxed iframes, or SSR/test runners — `crypto.subtle` is
 * `undefined`, and any direct `crypto.subtle.digest(...)` call throws
 * "Cannot read properties of undefined (reading 'digest')".
 *
 * To keep the wallet functional everywhere while using ONLY real, audited
 * cryptographic implementations, every digest/HMAC/PBKDF2 operations is
 * routed through this module: it prefers the native Web Crypto API when
 * available and transparently falls back to @noble/hashes (the pure-JS
 * audited library bip39 itself is built on). Outputs are byte-identical.
 */

import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import { sha512 as nobleSha512 } from '@noble/hashes/sha512';
import { hmac as nobleHmac } from '@noble/hashes/hmac';
import { pbkdf2 as noblePbkdf2 } from '@noble/hashes/pbkdf2';
import { gcm as nobleGcm } from '@noble/ciphers/aes';

const subtle = () =>
  typeof globalThis !== 'undefined' && globalThis.crypto?.subtle
    ? globalThis.crypto.subtle
    : undefined;

/** True when the native Web Crypto API is usable in this context. */
export const isWebCryptoAvailable = (): boolean => subtle() !== undefined;

const toU8 = (input: ArrayBuffer | Uint8Array | ArrayBufferView): Uint8Array =>
  input instanceof Uint8Array
    ? input
    : input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

/**
 * SHA-256 digest. Returns a fresh Uint8Array (32 bytes).
 * Same bytes as crypto.subtle.digest('SHA-256', ...).
 */
export async function sha256(input: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const s = subtle();
  if (s) {
    const buf = await s.digest('SHA-256', toU8(input).buffer as ArrayBuffer);
    return new Uint8Array(buf);
  }
  return nobleSha256(toU8(input));
}

/**
 * SHA-512 digest. Returns a fresh Uint8Array (64 bytes).
 * Same bytes as crypto.subtle.digest('SHA-512', ...).
 */
export async function sha512(input: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const s = subtle();
  if (s) {
    const buf = await s.digest('SHA-512', toU8(input).buffer as ArrayBuffer);
    return new Uint8Array(buf);
  }
  return nobleSha512(toU8(input));
}

/**
 * HMAC-SHA512 over `message` with 512-bit `key` material.
 * Same bytes as crypto.subtle.sign('HMAC', ...) with SHA-512.
 */
export async function hmacSha512(key: ArrayBuffer | Uint8Array, message: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const s = subtle();
  if (s) {
    const k = await s.importKey(
      'raw',
      toU8(key).buffer as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );
    const out = await s.sign('HMAC', k, toU8(message).buffer as ArrayBuffer);
    return new Uint8Array(out);
  }
  return nobleHmac(nobleSha512, toU8(key), toU8(message));
}

/**
 * PBKDF2-HMAC-SHA256. Returns `length` bytes (e.g. 32 for 256 bits).
 * Same bytes as crypto.subtle.deriveBits('PBKDF2', ..., SHA-256).
 */
export async function pbkdf2Sha256(
  password: ArrayBuffer | Uint8Array,
  salt: ArrayBuffer | Uint8Array,
  iterations: number,
  length = 32
): Promise<Uint8Array> {
  const s = subtle();
  if (s) {
    const baseKey = await s.importKey(
      'raw',
      toU8(password).buffer as ArrayBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const bits = await s.deriveBits(
      { name: 'PBKDF2', salt: toU8(salt).buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
      baseKey,
      length * 8
    );
    return new Uint8Array(bits);
  }
  return noblePbkdf2(nobleSha256, toU8(password), toU8(salt), { c: iterations, dkLen: length });
}

/**
 * AES-256-GCM encrypt.
 * `key` must be 32 bytes; `nonce` (IV) 12 bytes. Returns ciphertext with the
 * 16-byte GCM auth tag appended (same layout as crypto.subtle.encrypt AES-GCM).
 */
export async function aesGcmEncrypt(
  key: ArrayBuffer | Uint8Array,
  nonce: ArrayBuffer | Uint8Array,
  data: ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  const s = subtle();
  const keyU8 = toU8(key);
  const nonceU8 = toU8(nonce);
  const dataU8 = toU8(data);
  if (s) {
    const k = await s.importKey('raw', keyU8.buffer as ArrayBuffer, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const out = await s.encrypt({ name: 'AES-GCM', iv: nonceU8.buffer as ArrayBuffer }, k, dataU8.buffer as ArrayBuffer);
    return new Uint8Array(out);
  }
  return nobleGcm(keyU8, nonceU8).encrypt(dataU8);
}

/**
 * AES-256-GCM decrypt (inverse of aesGcmEncrypt).
 * Throws on auth-tag mismatch / tampered ciphertext.
 */
export async function aesGcmDecrypt(
  key: ArrayBuffer | Uint8Array,
  nonce: ArrayBuffer | Uint8Array,
  ciphertext: ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  const s = subtle();
  const keyU8 = toU8(key);
  const nonceU8 = toU8(nonce);
  const ctU8 = toU8(ciphertext);
  if (s) {
    const k = await s.importKey('raw', keyU8.buffer as ArrayBuffer, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const out = await s.decrypt({ name: 'AES-GCM', iv: nonceU8.buffer as ArrayBuffer }, k, ctU8.buffer as ArrayBuffer);
    return new Uint8Array(out);
  }
  return nobleGcm(keyU8, nonceU8).decrypt(ctU8);
}
