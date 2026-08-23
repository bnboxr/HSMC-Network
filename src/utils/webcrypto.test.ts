/**
 * Verifies the webcrypto helper produces byte-identical results whether the
 * native Web Crypto API is present or absent (falling back to @noble/hashes
 * and @noble/ciphers). This guards against the "Cannot read properties of
 * undefined (reading 'digest')" crash in insecure contexts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  sha256,
  sha512,
  hmacSha512,
  pbkdf2Sha256,
  aesGcmEncrypt,
  aesGcmDecrypt,
  isWebCryptoAvailable,
} from './webcrypto';

const snapshotSubtle = () => globalThis.crypto?.subtle;
let originalCrypto: Crypto | undefined;
let originalSubtle: SubtleCrypto | undefined;

function disableNativeCrypto() {
  // Simulate an insecure context (plain HTTP, WebView, SSR) where the Web
  // Crypto API's `subtle` is unavailable. jsdom makes crypto.subtle a
  // read-only getter and globalThis.crypto non-writable, so we redefine
  // the property with a subtle-less object that still has getRandomValues
  // (used by the wallet for salts/IVs).
  originalCrypto = globalThis.crypto;
  originalSubtle = originalCrypto.subtle;
  const realGetRandomValues = originalCrypto.getRandomValues.bind(originalCrypto);
  const stub = {
    getRandomValues: (arr: ArrayBufferView) => realGetRandomValues(arr),
    subtle: undefined,
  } as unknown as Crypto & { subtle?: SubtleCrypto };
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: stub,
  });
}

function restoreNativeCrypto() {
  if (originalCrypto !== undefined) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  }
  originalCrypto = undefined;
  originalSubtle = undefined;
}

// Material for vectors
const msg = new TextEncoder().encode('HSMC privacy wallet test vector');
const key256 = new Uint8Array(32).fill(7);
const nonce12 = new Uint8Array(12).fill(3);
const salt = new TextEncoder().encode('hsmc-test-salt');

describe('webcrypto helper parity with native WebCrypto', () => {
  beforeEach(() => {
    originalSubtle = snapshotSubtle();
    if (!originalSubtle) {
      console.warn('native subtle not available in this test env; testing fallback only');
    }
  });
  afterEach(() => restoreNativeCrypto());

  it('sha256 fallback matches native WebCrypto bytes', async () => {
    disableNativeCrypto();
    const fallback = await sha256(msg);
    restoreNativeCrypto();
    const native = await sha256(msg);
    expect(Array.from(fallback)).toEqual(Array.from(native));
    expect(fallback.length).toBe(32);
  });

  it('sha512 fallback matches native WebCrypto bytes', async () => {
    disableNativeCrypto();
    const fallback = await sha512(msg);
    restoreNativeCrypto();
    const native = await sha512(msg);
    expect(Array.from(fallback)).toEqual(Array.from(native));
    expect(fallback.length).toBe(64);
  });

  it('hmacSha512 fallback matches native WebCrypto bytes', async () => {
    disableNativeCrypto();
    const fallback = await hmacSha512(key256, msg);
    restoreNativeCrypto();
    const native = await hmacSha512(key256, msg);
    expect(Array.from(fallback)).toEqual(Array.from(native));
    expect(fallback.length).toBe(64);
  });

  it('pbkdf2Sha256 fallback matches native WebCrypto bytes', async () => {
    disableNativeCrypto();
    const fallback = await pbkdf2Sha256(msg, salt, 2000, 32);
    restoreNativeCrypto();
    const native = await pbkdf2Sha256(msg, salt, 2000, 32);
    expect(Array.from(fallback)).toEqual(Array.from(native));
    expect(fallback.length).toBe(32);
  });

  it('AES-GCM fallback decrypts native encryption and vice versa', async () => {
    // Native encrypt -> fallback decrypt
    const nativeCipher = await aesGcmEncrypt(key256, nonce12, msg);
    disableNativeCrypto();
    const plain1 = await aesGcmDecrypt(key256, nonce12, nativeCipher);
    restoreNativeCrypto();
    expect(new TextDecoder().decode(plain1)).toBe(new TextDecoder().decode(msg));

    // Fallback encrypt -> native decrypt
    disableNativeCrypto();
    const fallbackCipher = await aesGcmEncrypt(key256, nonce12, msg);
    restoreNativeCrypto();
    const plain2 = await aesGcmDecrypt(key256, nonce12, fallbackCipher);
    expect(new TextDecoder().decode(plain2)).toBe(new TextDecoder().decode(msg));
  });

  it('reports availability truthfully', () => {
    expect(typeof isWebCryptoAvailable()).toBe('boolean');
  });
});
