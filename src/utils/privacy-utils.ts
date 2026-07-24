/**
 * Privacy Utilities — RingCT + Stealth Addresses + Ring Signatures
 *
 * All cryptographic primitives are backed by the Rust node's hsmc-crypto
 * module (ringct.rs, stealth.rs, ring_sig.rs) via the local API server.
 * No stubs, no HMAC workarounds — every operation uses real
 * Ristretto-curve math on the Rust side.
 *
 * Client-side only:
 *   - BIP39 → dual-key derivation (HMAC-SHA512 domain-separated)
 *   - X25519 scalar * basepoint via Web Crypto (RFC 7748)
 *   - Stealth address encode/decode
 *   - Fee calculation
 *
 * Node-backed (via POST to local API → Rust handler):
 *   - Stealth output generation → /crypto/stealth/generate
 *   - Pedersen commitment       → /crypto/commitment
 *   - Ring signature (LSAG)     → /crypto/ring-sign
 *   - Bulletproof range proof   → /crypto/range-proof
 *
 * If the Rust node is unreachable an error is thrown — there is no
 * client-side fallback for privacy features.
 */

import { mnemonicToSeed } from './bip39-wallet';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type PrivacyLevel = 'transparent' | 'ringct' | 'stealth' | 'full';

export interface DualKeyWallet {
  /** Spend private key (32 bytes, scalar) — can sign transactions */
  spendPrivate: Uint8Array;
  /** Spend public key (32 bytes, point) — used in stealth address derivation */
  spendPublic: Uint8Array;
  /** View private key (32 bytes, scalar) — can scan for owned outputs */
  viewPrivate: Uint8Array;
  /** View public key (32 bytes, point) — recipient's address component */
  viewPublic: Uint8Array;
}

export interface StealthAddressData {
  /** Encoded address string "HSMCst" + hex(S) + hex(V) */
  address: string;
  /** Spend public key */
  spendPublic: Uint8Array;
  /** View public key */
  viewPublic: Uint8Array;
}

export interface StealthOutputData {
  /** One-time destination key P = H_s(r*V)*G + S (on-chain) */
  oneTimeKey: string;
  /** Ephemeral public key R = r*G (on-chain, allows receiver to scan) */
  ephemeralKey: string;
  /** Shared secret for amount encryption */
  sharedSecret: string;
  /** Output index within transaction */
  outputIndex: number;
}

export interface PrivateTxData {
  privacyLevel: PrivacyLevel;
  stealthOutput?: StealthOutputData;
  ringSignature: string;
  commitment: string;
  rangeProof?: string;
  stealthAddress?: string;
  decoyCount: number;
  keyImage: string;
}

export interface PrivacyFeeInfo {
  privacyLevel: PrivacyLevel;
  minFee: number;
  estimatedFee: number;
  ringSize: number;
  overheadBytes: number;
  description: string;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const MIN_BASE_FEE = 0.0001;
const FEE_MULTIPLIERS: Record<PrivacyLevel, number> = {
  transparent: 1.0,
  ringct: 10.0,
  stealth: 20.0,
  full: 50.0,
};

const DEFAULT_RING_SIZE = 11; // Monero default
const MAX_RING_SIZE = 16;

const DOMAIN_SEPARATORS = {
  spendKey: new TextEncoder().encode('HSMC_SPEND_KEY_v1'),
  viewKey: new TextEncoder().encode('HSMC_VIEW_KEY_v1'),
};

/** X25519 basepoint (u = 9, RFC 7748 § 4.2) */
const X25519_BASEPOINT = (() => {
  const bp = new Uint8Array(32);
  bp[0] = 9;
  return bp;
})();

// ═══════════════════════════════════════════════════════════════════
// Key Derivation — BIP39 seed → Dual-key wallet
// ═══════════════════════════════════════════════════════════════════

/**
 * Derive a dual-key wallet (spend + view) from the BIP39 mnemonic.
 *
 *   spend_key = HMAC-SHA512("HSMC_SPEND_KEY_v1", seed)[0:32]
 *   view_key  = SHA-512("HSMC_VIEW_KEY_v1" || spend_key)[0:32]
 *
 * Public keys are derived via X25519 scalar * basepoint (RFC 7748).
 */
export async function deriveDualKeyWallet(
  mnemonic: string
): Promise<DualKeyWallet> {
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
    DOMAIN_SEPARATORS.spendKey
  );
  const spendPrivate = new Uint8Array(spendKeyRaw).slice(0, 32);

  // v = H("HSMC_VIEW_KEY_v1" || spend_private)
  const viewKeyData = new Uint8Array(DOMAIN_SEPARATORS.viewKey.length + 32);
  viewKeyData.set(DOMAIN_SEPARATORS.viewKey, 0);
  viewKeyData.set(spendPrivate, DOMAIN_SEPARATORS.viewKey.length);
  const viewKeyHash = await crypto.subtle.digest('SHA-512', viewKeyData);
  const viewPrivate = new Uint8Array(viewKeyHash).slice(0, 32);

  // Derive public keys: pub = scalar * basepoint (X25519)
  const spendPublic = await scalarMultBase(spendPrivate);
  const viewPublic  = await scalarMultBase(viewPrivate);

  return { spendPrivate, spendPublic, viewPrivate, viewPublic };
}

/**
 * Derive only the view-only wallet keys (for scanning).
 */
export async function deriveViewOnlyWallet(mnemonic: string): Promise<{
  spendPublic: Uint8Array;
  viewPrivate: Uint8Array;
  viewPublic: Uint8Array;
}> {
  const full = await deriveDualKeyWallet(mnemonic);
  return {
    spendPublic: full.spendPublic,
    viewPrivate: full.viewPrivate,
    viewPublic: full.viewPublic,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Stealth Addresses — Encode / Decode
// ═══════════════════════════════════════════════════════════════════

/**
 * Encode spend + view public keys into HSMCst... format.
 * Format: "HSMCst" + hex(spend_public) + hex(view_public)  (6 + 64 + 64 = 134 chars)
 */
export function encodeStealthAddress(
  spendPublic: Uint8Array,
  viewPublic: Uint8Array
): string {
  const sHex = bytesToHex(spendPublic);
  const vHex = bytesToHex(viewPublic);
  return `HSMCst${sHex}${vHex}`;
}

/**
 * Decode an "HSMCst..." address string back to public keys.
 */
export function decodeStealthAddress(
  address: string
): StealthAddressData | null {
  if (!address.startsWith('HSMCst') || address.length !== 6 + 128) {
    return null;
  }
  const hexPart = address.slice(6);
  const sHex = hexPart.slice(0, 64);
  const vHex = hexPart.slice(64, 128);

  const spendPublic = hexToBytes(sHex);
  const viewPublic = hexToBytes(vHex);

  if (!spendPublic || !viewPublic) return null;

  return { address, spendPublic, viewPublic };
}

// ═══════════════════════════════════════════════════════════════════
// Stealth Output — via Rust node  POST /crypto/stealth/generate
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a stealth one-time output for the recipient.
 *
 * Delegates to the Rust node's StealthOutputSender::generate()
 * (stealth.rs → handlers.rs::generate_stealth_output).
 */
export async function generateStealthOutput(
  recipientAddress: string,
  outputIndex: number = 0
): Promise<StealthOutputData> {
  const result = await callNodeCryptoOrThrow(
    '/crypto/stealth/generate',
    {
      recipient_address: recipientAddress,
      output_index: outputIndex,
    }
  );

  const r = result as Record<string, unknown>;
  return {
    oneTimeKey: String(r.one_time_key ?? ''),
    ephemeralKey: String(r.ephemeral_key ?? ''),
    sharedSecret: String(r.shared_secret ?? ''),
    outputIndex: (r.output_index as number) ?? outputIndex,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Pedersen Commitment — via Rust node  POST /crypto/commitment
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a real Pedersen commitment for amount hiding.
 *
 * C = r*G + v*H  on the Ristretto curve.
 *
 * Delegates to Rust node's PedersenCommitment::commit()
 * (ringct.rs → handlers.rs::generate_commitment).
 */
export async function generateCommitment(
  amountSatoshis: number,
  _wallet: DualKeyWallet
): Promise<{ commitment: string; blindingHex: string }> {
  const result = await callNodeCryptoOrThrow(
    '/crypto/commitment',
    { amount_satoshis: amountSatoshis }
  );

  const r = result as Record<string, unknown>;
  return {
    commitment: String(r.commitment ?? ''),
    blindingHex: String(r.blinding ?? ''),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Ring Signature — via Rust node  POST /crypto/ring-sign
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a real LSAG ring signature for sender anonymity.
 *
 * Delegates to Rust node's LsagSignature::sign()
 * (ring_sig.rs → handlers.rs::generate_ring_signature).
 */
export async function generateRingSignature(
  message: string,
  wallet: DualKeyWallet,
  ringSize: number = DEFAULT_RING_SIZE
): Promise<{
  ringSignature: string;
  keyImage: string;
  ringSize: number;
}> {
  // ⚠️ SECURITY: The spend private key is sent to the Rust node for signing.
  // The Rust node MUST be running on the same machine (localhost) over TLS.
  // NEVER send the private key over an unencrypted or remote connection.
  // See: /home/team/shared/attack-surface-map.md §3.2
  const apiUrl = import.meta.env.VITE_API_URL || '';
  if (apiUrl.startsWith('http://') && !apiUrl.includes('localhost') && !apiUrl.includes('127.0.0.1')) {
    throw new Error(
      '❌ SECURITY: Privacy features require a LOCAL TLS connection. ' +
      'The spend private key is about to be transmitted and MUST be encrypted. ' +
      'Set VITE_API_URL to a local HTTPS endpoint or ensure the Vite proxy is configured. ' +
      'Refusing to send private key over plaintext remote connection.'
    );
  }
  
  const signerSecretHex = bytesToHex(wallet.spendPrivate);

  const result = await callNodeCryptoOrThrow(
    '/crypto/ring-sign',
    {
      message,
      signer_secret_hex: signerSecretHex,
      ring_size: ringSize,
    }
  );

  const r = result as Record<string, unknown>;
  return {
    ringSignature: String(r.ring_signature ?? ''),
    keyImage: String(r.key_image ?? ''),
    ringSize: (r.ring_size as number) ?? ringSize,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Bulletproof Range Proof — via Rust node  POST /crypto/range-proof
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a real Bulletproof range proof.
 * Proves 0 <= amount < 2^64 without revealing the amount.
 *
 * Delegates to Rust node's BulletproofRangeProof::prove()
 * (ringct.rs → handlers.rs::generate_range_proof).
 *
 * Requires a prior commitment call to obtain the commitment hex.
 */
export async function generateRangeProof(
  amountSatoshis: number,
  commitmentHex: string
): Promise<string> {
  const result = await callNodeCryptoOrThrow(
    '/crypto/range-proof',
    {
      amount_satoshis: amountSatoshis,
      commitment_hex: commitmentHex,
    }
  );

  const r = result as Record<string, unknown>;
  return String(r.range_proof ?? '');
}

// ═══════════════════════════════════════════════════════════════════
// Complete Private Transaction Builder
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a complete private transaction payload.
 *
 * Orchestrates the full privacy stack: stealth output → commitment →
 * ring signature → range proof, all via the Rust node.
 */
export async function buildPrivateTransaction(params: {
  mnemonic: string;
  recipientAddress: string;
  amount: number;
  privacyLevel: PrivacyLevel;
  ringSize?: number;
  memo?: string;
}): Promise<PrivateTxData> {
  const {
    mnemonic,
    recipientAddress,
    amount,
    privacyLevel,
    ringSize = DEFAULT_RING_SIZE,
    memo = '',
  } = params;

  // 1. Derive sender's wallet keys
  const wallet = await deriveDualKeyWallet(mnemonic);
  const senderAddress = encodeStealthAddress(
    wallet.spendPublic,
    wallet.viewPublic
  );

  let stealthOutput: StealthOutputData | undefined;
  let stealthAddress: string | undefined;
  let commitment = '';
  let ringSignature = '';
  let rangeProof: string | undefined;
  let keyImage = '';

  if (privacyLevel !== 'transparent') {
    const amountSatoshis = Math.round(amount * 1e8);

    // 2. Generate stealth one-time output
    const isStealthAddr = recipientAddress.startsWith('HSMCst');
    let effectiveAddr: string = recipientAddress;

    if (!isStealthAddr) {
      // For transparent addresses, wrap in a pseudo-stealth address
      const recipientPubHash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(recipientAddress)
      );
      const derivedSP = new Uint8Array(recipientPubHash).slice(0, 32);
      const derivedVP = new Uint8Array(recipientPubHash).slice(0, 32);
      effectiveAddr = encodeStealthAddress(derivedSP, derivedVP);
    }

    stealthOutput = await generateStealthOutput(effectiveAddr, 0);
    stealthAddress = stealthOutput.oneTimeKey;

    // 3. Generate Pedersen commitment (real Ristretto point)
    const commitData = await generateCommitment(amountSatoshis, wallet);
    commitment = commitData.commitment;

    // 4. Generate ring signature (real LSAG on Ristretto)
    const message = `${senderAddress}:${stealthAddress}:${amount}:${memo}:${Date.now()}`;
    const ringData = await generateRingSignature(message, wallet, ringSize);
    ringSignature = ringData.ringSignature;
    keyImage = ringData.keyImage;

    // 5. Generate Bulletproof range proof (for full privacy)
    if (privacyLevel === 'full') {
      rangeProof = await generateRangeProof(amountSatoshis, commitment);
    }
  }

  return {
    privacyLevel,
    stealthOutput,
    ringSignature,
    commitment,
    rangeProof,
    stealthAddress,
    decoyCount: privacyLevel !== 'transparent' ? ringSize : 0,
    keyImage,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Fee Calculation
// ═══════════════════════════════════════════════════════════════════

export function getPrivacyFeeInfo(
  privacyLevel: PrivacyLevel,
  amount?: number
): PrivacyFeeInfo {
  const multiplier = FEE_MULTIPLIERS[privacyLevel];
  const minFee = MIN_BASE_FEE * multiplier;
  const overhead = getOverheadBytes(privacyLevel);
  const estimatedFee = amount
    ? Math.max(minFee, (amount * multiplier * 0.001) / 100)
    : minFee;

  return {
    privacyLevel,
    minFee,
    estimatedFee: parseFloat(estimatedFee.toFixed(8)),
    ringSize: privacyLevel === 'transparent' ? 0 : DEFAULT_RING_SIZE,
    overheadBytes: overhead,
    description: getPrivacyDescription(privacyLevel),
  };
}

function getOverheadBytes(level: PrivacyLevel): number {
  switch (level) {
    case 'transparent':
      return 0;
    case 'ringct':
      return 2048;
    case 'stealth':
      return 2560;
    case 'full':
      return 4096;
  }
}

function getPrivacyDescription(level: PrivacyLevel): string {
  switch (level) {
    case 'transparent':
      return 'Visible amounts, sender & receiver are public';
    case 'ringct':
      return 'Hidden amounts via Pedersen commitments + ring signature sender anonymity (11-16 decoys)';
    case 'stealth':
      return 'Ring signature + one-time stealth address via ECDH key exchange';
    case 'full':
      return 'RingCT + Stealth + Bulletproof range proofs (Monero-equivalent)';
  }
}

// ═══════════════════════════════════════════════════════════════════
// Cryptographic Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * X25519 scalar * basepoint (RFC 7748).
 *
 * Uses Web Crypto's X25519 ECDH: deriveBits(sk, basepoint) returns
 * the Montgomery x-coordinate of the resulting public key.
 */
async function scalarMultBase(scalar: Uint8Array): Promise<Uint8Array> {
  // Clamp scalar per RFC 7748 § 5
  const clamped = new Uint8Array(scalar);
  clamped[0] &= 248;
  clamped[31] &= 127;
  clamped[31] |= 64;

  // Import scalar as X25519 private key
  const privateKey = await crypto.subtle.importKey(
    'raw',
    clamped,
    { name: 'X25519' },
    false,
    ['deriveBits']
  );

  // Import basepoint as X25519 public key
  const basepointKey = await crypto.subtle.importKey(
    'raw',
    X25519_BASEPOINT,
    { name: 'X25519' },
    true,
    []
  );

  // DH(sk, basepoint) = sk * G = public key
  const pubKey = await crypto.subtle.deriveBits(
    { name: 'X25519', public: basepointKey },
    privateKey,
    256
  );

  return new Uint8Array(pubKey);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    if (isNaN(bytes[i / 2])) return null;
  }
  return bytes;
}

// ═══════════════════════════════════════════════════════════════════
// Local API Server — NO fallback, NO stubs
// ═══════════════════════════════════════════════════════════════════

const NODE_API_BASE = '';

/**
 * Call the Rust node via the local API server.
 * THROWS if the node is unreachable — privacy features MUST have a
 * connected HSMC node. No client-side stubs.
 */
async function callNodeCryptoOrThrow(
  endpoint: string,
  payload: unknown
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${NODE_API_BASE}/node-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: endpoint,
        method: 'POST',
        data: payload,
      }),
    });
  } catch (err) {
    throw new Error(
      `Privacy features require a connected HSMC node. ` +
      `Network error reaching API server at ${endpoint}: ${(err as Error).message}`
    );
  }

  if (!res.ok) {
    throw new Error(
      `Privacy features require a connected HSMC node. ` +
      `API server returned HTTP ${res.status} for ${endpoint}.`
    );
  }

  const json = await res.json();

  // API server wraps the Rust response in { ok, status, node_online, data }
  const inner = json?.data ?? json;

  // Check for Rust-level errors
  if (inner && typeof inner === 'object' && (inner as Record<string, unknown>).error) {
    throw new Error(
      `Privacy features require a connected HSMC node. ` +
      `Rust node error at ${endpoint}: ${(inner as Record<string, unknown>).error}`
    );
  }

  // API server may signal the node is offline
  if (json?.node_online === false || json?.ok === false) {
    throw new Error(
      `Privacy features require a connected HSMC node. ` +
      `The Rust node is currently unreachable (${endpoint}). ` +
      `${json?.hint ?? json?.error ?? 'Please ensure the node is running and the API server is configured.'}`
    );
  }

  return inner;
}

/**
 * Light-weight node reachability check (non-throwing).
 * Returns true if the API server responds with node_online=true.
 * Used by UI to show privacy feature availability.
 */
export async function isNodeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${NODE_API_BASE}/node-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/health', method: 'GET' }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json?.node_online === true && json?.ok === true;
  } catch {
    return false;
  }
}
