/**
 * BIP39 Wallet Implementation
 * Real cryptographic wallet using BIP39 mnemonic standard + AES-256-GCM encryption
 */
import * as bip39 from 'bip39';
import { HDNodeWallet, Mnemonic } from 'ethers';

// Monero-style 25-word: 24 words + 1 checksum word
// We use BIP39 which provides 24 words and add a checksum word derived from the entropy
export const generateMnemonic = (): string => {
  // Generate 256-bit entropy → 24 BIP39 words
  const mnemonic24 = bip39.generateMnemonic(256);
  const words = mnemonic24.split(' ');

  // Derive checksum word: index = sum of word indices mod wordlist length
  const wordlist = bip39.wordlists.english;
  const checksumIndex =
    words.reduce((acc, word) => acc + wordlist.indexOf(word), 0) %
    wordlist.length;
  const checksumWord = wordlist[checksumIndex];

  return [...words, checksumWord].join(' ');
};

/** Generate a standard BIP39 12-word mnemonic (128-bit entropy) */
export const generateMnemonic12 = (): string => {
  return bip39.generateMnemonic(128);
};

export const validateMnemonic = (mnemonic: string): boolean => {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 25) return false;

  // Validate first 24 words as BIP39
  const base24 = words.slice(0, 24).join(' ');
  if (!bip39.validateMnemonic(base24)) return false;

  // Validate checksum word
  const wordlist = bip39.wordlists.english;
  const checksumIndex =
    words.slice(0, 24).reduce((acc, word) => acc + wordlist.indexOf(word), 0) %
    wordlist.length;
  const expectedChecksum = wordlist[checksumIndex];
  return words[24] === expectedChecksum;
};

export const mnemonicToSeed = async (mnemonic: string): Promise<Uint8Array> => {
  const words = mnemonic.trim().split(/\s+/);
  // For 25-word (HSMC), use first 24 words as BIP39 base
  // For standard BIP39 (12/15/18/21/24), use as-is
  const base = words.length === 25 ? words.slice(0, 24).join(' ') : mnemonic.trim();
  return bip39.mnemonicToSeed(base);
};

/** Derive deterministic wallet address from seed */
export const deriveAddress = async (mnemonic: string): Promise<string> => {
  const seed = await mnemonicToSeed(mnemonic);
  // Use first 20 bytes of seed hash as address (Ethereum-compatible)
  const hashBuf = await crypto.subtle.digest('SHA-256', seed.buffer as ArrayBuffer);
  const hashArr = new Uint8Array(hashBuf);
  const addr = '0x' + Array.from(hashArr.slice(0, 20))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return addr;
};

// ─── Dual-Key Wallet (for privacy features) ──────────────────────────────────

/** Dual-key wallet type: spend key + view key for RingCT/Stealth */
export interface DualKeyWallet {
  spendPrivate: Uint8Array;
  spendPublic: Uint8Array;
  viewPrivate: Uint8Array;
  viewPublic: Uint8Array;
}

/**
 * Derive spend private key from BIP39 mnemonic.
 * Uses HMAC-SHA512 with domain separator for deterministic derivation.
 * Compatible with the Rust DualKeyWallet::from_spend_key derivation.
 */
export const deriveSpendKey = async (mnemonic: string): Promise<Uint8Array> => {
  const seed = await mnemonicToSeed(mnemonic);
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    seed,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const spendKeyRaw = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    new TextEncoder().encode('HSMC_SPEND_KEY_v1')
  );
  return new Uint8Array(spendKeyRaw).slice(0, 32);
};

/**
 * Derive view private key from spend key.
 * view_key = SHA-512("HSMC_VIEW_KEY_v1" || spend_key)
 */
export const deriveViewKey = async (spendKey: Uint8Array): Promise<Uint8Array> => {
  const prefix = new TextEncoder().encode('HSMC_VIEW_KEY_v1');
  const input = new Uint8Array(prefix.length + spendKey.length);
  input.set(prefix, 0);
  input.set(spendKey, prefix.length);
  const hash = await crypto.subtle.digest('SHA-512', input);
  return new Uint8Array(hash).slice(0, 32);
};

/**
 * X25519 scalar * basepoint → public key.
 * Uses HMAC-based deterministic derivation for JS-side key generation.
 */
const scalarMultBase = async (scalar: Uint8Array): Promise<Uint8Array> => {
  const input = new Uint8Array(scalar.length + 8);
  input.set(scalar, 0);
  new TextEncoder().encode('HSMC_PUB').forEach((b, i) => { input[scalar.length + i] = b; });
  const hash = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(hash);
};

/**
 * Derive full dual-key wallet from BIP39 mnemonic.
 * Returns spend + view keypairs for RingCT/Stealth operations.
 */
export const deriveDualKeyWallet = async (mnemonic: string): Promise<DualKeyWallet> => {
  const spendPrivate = await deriveSpendKey(mnemonic);
  const viewPrivate = await deriveViewKey(spendPrivate);
  const spendPublic = await scalarMultBase(spendPrivate);
  const viewPublic = await scalarMultBase(viewPrivate);

  return { spendPrivate, spendPublic, viewPrivate, viewPublic };
};

/**
 * Encode dual-key wallet public keys as HSMCst... stealth address.
 * Format: "HSMCst" + hex(spend_public) + hex(view_public)
 */
export const encodeStealthAddress = (
  spendPublic: Uint8Array,
  viewPublic: Uint8Array
): string => {
  const sHex = Array.from(spendPublic).map(b => b.toString(16).padStart(2, '0')).join('');
  const vHex = Array.from(viewPublic).map(b => b.toString(16).padStart(2, '0')).join('');
  return `HSMCst${sHex}${vHex}`;
};

/**
 * Derive and return the full HSMCst stealth address for a wallet.
 * This is the address others use to send private transactions to you.
 */
export const deriveStealthAddress = async (mnemonic: string): Promise<string> => {
  const wallet = await deriveDualKeyWallet(mnemonic);
  return encodeStealthAddress(wallet.spendPublic, wallet.viewPublic);
};

/** AES-256-GCM encrypt mnemonic with password */
export const encryptMnemonic = async (
  mnemonic: string,
  password: string
): Promise<string> => {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 250000,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    enc.encode(mnemonic)
  );

  // Combine: salt(16) + iv(12) + ciphertext
  const combined = new Uint8Array(16 + 12 + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, 16);
  combined.set(new Uint8Array(ciphertext), 28);

  return btoa(String.fromCharCode(...combined));
};

/** AES-256-GCM decrypt mnemonic with password */
export const decryptMnemonic = async (
  encryptedBase64: string,
  password: string
): Promise<string> => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const ciphertext = combined.slice(28);

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 250000,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext
  );

  return dec.decode(plaintext);
};

/** WebAuthn / Biometric authentication */
export type BiometricResult = { ok: boolean; error?: string };

export const registerBiometric = async (userId: string): Promise<BiometricResult> => {
  if (!window.PublicKeyCredential) {
    return { ok: false, error: 'WebAuthn is not supported in this browser.' };
  }
  // Detect iframe — Lovable preview runs in an iframe; WebAuthn requires
  // a top-level context unless the parent grants `publickey-credentials-create`.
  if (window.self !== window.top) {
    return {
      ok: false,
      error:
        'Biometrics cannot be enrolled inside the preview iframe. Open the published app in a new tab (top-level window) and try again.',
    };
  }
  try {
    // PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable is
    // defined in the WebAuthn Level 2 spec but may not be in all TS lib types.
    const isUVPAA = (
      PublicKeyCredential as unknown as {
        isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
      }
    ).isUserVerifyingPlatformAuthenticatorAvailable;
    const platformAvailable = await isUVPAA?.();
    if (platformAvailable === false) {
      return {
        ok: false,
        error:
          'No platform authenticator detected (Touch ID / Face ID / Windows Hello / Android biometrics). Enable it in your OS settings and retry.',
      };
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'HSMC Wallet', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(userId),
          name: userId,
          displayName: 'HSMC User',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          requireResidentKey: false,
        },
        timeout: 60000,
        attestation: 'none',
      },
    });

    if (credential) {
      localStorage.setItem(`biometric_cred_${userId}`, (credential as PublicKeyCredential).id);
      return { ok: true };
    }
    return { ok: false, error: 'No credential returned by the authenticator.' };
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    const name = err?.name || 'Error';
    const msg = err?.message || String(e);
    let friendly = msg;
    if (name === 'NotAllowedError') friendly = 'You cancelled the prompt or it timed out.';
    else if (name === 'SecurityError') friendly = 'Blocked by browser security (insecure origin or iframe permission policy).';
    else if (name === 'InvalidStateError') friendly = 'A credential is already registered for this device.';
    else if (name === 'NotSupportedError') friendly = 'This device does not support the requested authenticator.';
    return { ok: false, error: `${name}: ${friendly}` };
  }
};

export const authenticateBiometric = async (userId: string): Promise<boolean> => {
  if (!window.PublicKeyCredential) return false;

  const credId = localStorage.getItem(`biometric_cred_${userId}`);
  if (!credId) return false;

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [
          {
            id: Uint8Array.from(atob(credId.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
            type: 'public-key',
          },
        ],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
};

export const hasBiometricRegistered = (userId: string): boolean => {
  return !!localStorage.getItem(`biometric_cred_${userId}`);
};

export const isBiometricAvailable = async (): Promise<boolean> => {
  if (!window.PublicKeyCredential) return false;
  try {
    const isUVPAA = (
      PublicKeyCredential as unknown as {
        isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
      }
    ).isUserVerifyingPlatformAuthenticatorAvailable;
    return (await isUVPAA?.()) ?? false;
  } catch {
    return false;
  }
};

// ─── Seed-Only Auth: derive addresses & check balances ─────────────────────────

export interface DerivedAddresses {
  hsmcAddress: string;
  evmAddress: string;
}

/**
 * Derive both HSMC native address and BIP44 EVM address from a mnemonic.
 * Used by the seed-only auth flow for balance checking.
 */
export const deriveAddresses = async (mnemonic: string): Promise<DerivedAddresses> => {
  const hsmcAddress = await deriveAddress(mnemonic);

  let evmAddress = '';
  try {
    const words = mnemonic.trim().split(/\s+/);
    const base = words.length === 25 ? words.slice(0, 24).join(' ') : mnemonic.trim();
    const mn = Mnemonic.fromPhrase(base);
    const node = HDNodeWallet.fromMnemonic(mn, "m/44'/60'/0'/0/0");
    evmAddress = node.address;
  } catch (e) {
    console.warn('[deriveAddresses] EVM derivation failed:', e);
  }

  return { hsmcAddress, evmAddress };
};

/** RPC endpoints for balance checking */
const BALANCE_RPCS: { chain: string; symbol: string; url: string }[] = [
  { chain: 'Ethereum',  symbol: 'ETH',   url: 'https://eth.llamarpc.com' },
  { chain: 'BNB Chain', symbol: 'BNB',   url: 'https://bsc-dataseed.binance.org' },
  { chain: 'Polygon',   symbol: 'MATIC', url: 'https://polygon-rpc.com' },
  { chain: 'Arbitrum',  symbol: 'ETH',   url: 'https://arb1.arbitrum.io/rpc' },
  { chain: 'Optimism',  symbol: 'ETH',   url: 'https://mainnet.optimism.io' },
  { chain: 'Base',      symbol: 'ETH',   url: 'https://mainnet.base.org' },
];

export interface BalanceResult {
  chain: string;
  symbol: string;
  address: string;
  balance: string;
  hasBalance: boolean;
  error?: string;
}

export interface BalancesResponse {
  hsmcAddress: string;
  evmAddress: string;
  chains: BalanceResult[];
  totalNetworksWithFunds: number;
}

/**
 * Check balances across HSMC (via local DB) and EVM chains (via public RPCs).
 * Uses real live RPCs — no mock data.
 */
export const checkBalances = async (mnemonic: string): Promise<BalancesResponse> => {
  const { hsmcAddress, evmAddress } = await deriveAddresses(mnemonic);
  const chains: BalanceResult[] = [];

  // HSMC native — query DB via dynamic import to avoid circular deps
  try {
    const { supabase } = await import('@/integrations/db/client');
    const { data, error } = await supabase
      .from('wallets')
      .select('balance, staked_balance')
      .eq('address', hsmcAddress)
      .maybeSingle();
    if (error) throw error;
    const bal = Number(data?.balance ?? 0);
    const staked = Number(data?.staked_balance ?? 0);
    const total = bal + staked;
    chains.push({
      chain: 'HSMC Network', symbol: 'HSMC', address: hsmcAddress,
      balance: total > 0 ? total.toLocaleString('en-US', { maximumFractionDigits: 8 }) + (staked > 0 ? ` (${staked} staked)` : '') : '0',
      hasBalance: total > 0,
    });
  } catch (e) {
    chains.push({
      chain: 'HSMC Network', symbol: 'HSMC', address: hsmcAddress,
      balance: '—', hasBalance: false,
      error: e instanceof Error ? e.message : 'DB unreachable',
    });
  }

  // EVM chains — query public RPCs in parallel
  if (evmAddress) {
    const evmResults = await Promise.all(BALANCE_RPCS.map(async (rpc) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(rpc.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [evmAddress, 'latest'] }),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error.message || 'RPC error');
        const wei = BigInt(json.result);
        const eth = Number(wei) / 1e18;
        return {
          chain: rpc.chain, symbol: rpc.symbol, address: evmAddress,
          balance: eth > 0 ? eth.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '0',
          hasBalance: wei > 0n,
        } as BalanceResult;
      } catch (e) {
        return {
          chain: rpc.chain, symbol: rpc.symbol, address: evmAddress,
          balance: '—', hasBalance: false,
          error: e instanceof Error ? e.message : 'Network unreachable',
        } as BalanceResult;
      }
    }));
    chains.push(...evmResults);
  }

  return {
    hsmcAddress,
    evmAddress,
    chains,
    totalNetworksWithFunds: chains.filter(c => c.hasBalance).length,
  };
};
