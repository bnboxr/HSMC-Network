/**
 * Browser-compatible Stratum V2 utilities:
 *   - V2 binary framing (encode/decode)
 *   - V2 message types
 *   - Noise IK initiator handshake (Noise_IK_25519_AESGCM_BLAKE2b)
 *
 * Uses Web Crypto API for X25519 and AES-256-GCM,
 * and a pure-JS BLAKE2b-512 for hashing.
 */

import { blake2b512 } from './blake2b';

// ─── Constants ──────────────────────────────────────────────────────────

const HASHLEN = 64;
const BLOCKLEN = 128;
const DHLEN = 32;
const KEYLEN = 32;
const NONCELEN = 12;
const TAGLEN = 16;

const PROTOCOL_NAME = 'Noise_IK_25519_AESGCM_BLAKE2b';
const V2_PROTOCOL_ID = 0x0002;

// ─── BLAKE2b + HMAC + HKDF ──────────────────────────────────────────────

function blake2b(data: Uint8Array): Uint8Array {
  return blake2b512(data);
}

function hmacBlake2b(key: Uint8Array, data: Uint8Array): Uint8Array {
  let k = key;
  if (key.length > BLOCKLEN) k = blake2b(key);
  if (k.length < BLOCKLEN) {
    const padded = new Uint8Array(BLOCKLEN);
    padded.set(k);
    k = padded;
  }

  const ipad = new Uint8Array(BLOCKLEN);
  const opad = new Uint8Array(BLOCKLEN);
  for (let i = 0; i < BLOCKLEN; i++) {
    ipad[i] = k[i] ^ 0x36;
    opad[i] = k[i] ^ 0x5c;
  }

  const innerInput = new Uint8Array(BLOCKLEN + data.length);
  innerInput.set(ipad);
  innerInput.set(data, BLOCKLEN);
  const innerHash = blake2b(innerInput);

  const outerInput = new Uint8Array(BLOCKLEN + HASHLEN);
  outerInput.set(opad);
  outerInput.set(innerHash, BLOCKLEN);
  return blake2b(outerInput);
}

function hkdfBlake2b(chainingKey: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
  const tempKey = hmacBlake2b(chainingKey, ikm);
  const output1 = hmacBlake2b(tempKey, new Uint8Array([0x01]));
  const output2 = hmacBlake2b(tempKey, concatBytes(output1, new Uint8Array([0x02])));
  return [output1, output2];
}

// ─── Helpers ────────────────────────────────────────────────────────────

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function makeNonce(n: number): Uint8Array {
  const buf = new Uint8Array(NONCELEN);
  const nBig = BigInt(n);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number((nBig >> BigInt(i * 8)) & 0xFFn);
  }
  return buf;
}

function zeroBytes(len: number): Uint8Array {
  return new Uint8Array(len);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── Web Crypto AES-GCM ─────────────────────────────────────────────────

async function aesGcmEncrypt(
  key: CryptoKey,
  nonce12: Uint8Array,
  ad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce12, tagLength: TAGLEN * 8, additionalData: ad },
    key,
    plaintext,
  );
  return new Uint8Array(encrypted);
}

async function aesGcmDecrypt(
  key: CryptoKey,
  nonce12: Uint8Array,
  ad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce12, tagLength: TAGLEN * 8, additionalData: ad },
    key,
    ciphertext,
  );
  return new Uint8Array(decrypted);
}

// ─── X25519 Helpers ─────────────────────────────────────────────────────

async function generateX25519KeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair;
}

async function exportPublicKey(kp: CryptoKeyPair): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return new Uint8Array(raw);
}

async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'X25519' }, false, []);
}

async function x25519Dh(privateKey: CryptoKey, peerPub: Uint8Array): Promise<Uint8Array> {
  const peerKey = await importPublicKey(peerPub);
  const bits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: peerKey },
    privateKey,
    256,
  );
  return new Uint8Array(bits);
}

async function aesKeyFromBytes(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ─── Noise IK Initiator ─────────────────────────────────────────────────

class CipherState {
  k: CryptoKey | null = null;
  n: number = 0;

  hasKey(): boolean {
    return this.k !== null;
  }

  async initializeKey(keyBytes: Uint8Array): Promise<void> {
    this.k = await aesKeyFromBytes(keyBytes);
    this.n = 0;
  }

  async encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.hasKey()) return new Uint8Array(plaintext);
    this.n++;
    return aesGcmEncrypt(this.k!, makeNonce(this.n), ad, plaintext);
  }

  async decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
    if (!this.hasKey()) return new Uint8Array(ciphertext);
    this.n++;
    return aesGcmDecrypt(this.k!, makeNonce(this.n), ad, ciphertext);
  }
}

class SymmetricState {
  ck: Uint8Array;
  h: Uint8Array;
  cs: CipherState;

  constructor() {
    const nameBytes = new TextEncoder().encode(PROTOCOL_NAME);
    if (nameBytes.length <= HASHLEN) {
      this.h = new Uint8Array(HASHLEN);
      this.h.set(nameBytes);
    } else {
      this.h = blake2b(nameBytes);
    }
    this.ck = new Uint8Array(this.h);
    this.cs = new CipherState();
  }

  mixKey(ikm: Uint8Array): Promise<void> {
    const [newCk, tempK] = hkdfBlake2b(this.ck, ikm);
    this.ck = newCk;
    return this.cs.initializeKey(tempK.slice(0, KEYLEN));
  }

  mixHash(data: Uint8Array): void {
    this.h = blake2b(concatBytes(this.h, data));
  }

  async encryptAndHash(plaintext: Uint8Array): Promise<Uint8Array> {
    const ct = await this.cs.encryptWithAd(this.h, plaintext);
    this.mixHash(ct);
    return ct;
  }

  async decryptAndHash(ciphertext: Uint8Array): Promise<Uint8Array> {
    const pt = await this.cs.decryptWithAd(this.h, ciphertext);
    this.mixHash(ciphertext);
    return pt;
  }

  split(): [CipherState, CipherState] {
    const [k1, k2] = hkdfBlake2b(this.ck, new Uint8Array(0));
    const cs1 = new CipherState();
    const cs2 = new CipherState();
    return [cs1, cs2];
  }
}

/**
 * Noise IK initiator handshake.
 * Used by the mining client to establish an encrypted V2 session.
 */
class NoiseIKInitiator {
  private ss: SymmetricState;
  private s: CryptoKeyPair | null = null;
  private e: CryptoKeyPair | null = null;
  private rs: Uint8Array; // server's static public key
  private complete = false;

  /**
   * @param serverStaticPub - Server's Noise static public key (32 bytes)
   */
  constructor(serverStaticPub: Uint8Array) {
    this.rs = serverStaticPub;
    this.ss = new SymmetricState();

    // IK pre-message: <- s
    // MixHash(rs) - initiator knows responder's static key
    this.ss.mixHash(serverStaticPub);
  }

  isComplete(): boolean {
    return this.complete;
  }

  /**
   * Generate the first handshake message: -> e, es, s, ss
   */
  async writeMessage1(): Promise<Uint8Array> {
    // Generate ephemeral keypair
    this.e = await generateX25519KeyPair();
    const ePublic = await exportPublicKey(this.e);

    // Generate static keypair (or use a known one)
    this.s = await generateX25519KeyPair();
    const sPublic = await exportPublicKey(this.s);

    // -> e: write e.public, MixHash
    const parts: Uint8Array[] = [ePublic];
    this.ss.mixHash(ePublic);

    // -> es: MixKey(DH(e, rs))
    const esDh = await x25519Dh(this.e.privateKey, this.rs);
    await this.ss.mixKey(esDh);

    // -> s: EncryptAndHash(s.public)
    const encryptedS = await this.ss.encryptAndHash(sPublic);
    parts.push(encryptedS);

    // -> ss: MixKey(DH(s, rs))
    const ssDh = await x25519Dh(this.s.privateKey, this.rs);
    await this.ss.mixKey(ssDh);

    // Concatenate: [e.public (32)] [encrypted_s (32+16=48)]
    let totalLen = 0;
    for (const p of parts) totalLen += p.length;
    const msg = new Uint8Array(totalLen);
    let offset = 0;
    for (const p of parts) {
      msg.set(p, offset);
      offset += p.length;
    }
    return msg;
  }

  /**
   * Process the response message: <- e, ee, se
   */
  async readMessage2(msg: Uint8Array): Promise<void> {
    if (this.complete) throw new Error('Handshake already complete');

    // <- e: read responder's ephemeral public key
    if (msg.length < DHLEN) throw new Error(`Message too short: ${msg.length}`);
    const re = msg.slice(0, DHLEN);
    this.ss.mixHash(re);

    // <- ee: MixKey(DH(e_initiator, re_responder))
    const eeDh = await x25519Dh(this.e!.privateKey, re);
    await this.ss.mixKey(eeDh);

    // <- se: MixKey(DH(s_initiator, re_responder))
    const seDh = await x25519Dh(this.s!.privateKey, re);
    await this.ss.mixKey(seDh);

    this.complete = true;
  }

  /**
   * Split into transport CipherStates after handshake.
   * Returns [sendCipherState, recvCipherState]
   */
  split(): [CipherState, CipherState] {
    if (!this.complete) throw new Error('Handshake not complete');
    return this.ss.split();
  }
}

// ─── V2 Binary Framing ──────────────────────────────────────────────────

export enum V2MsgType {
  SetupConnection = 0x00,
  SetupConnectionSuccess = 0x01,
  SetupConnectionError = 0x02,
  NewMiningJob = 0x10,
  SubmitShare = 0x11,
  SubmitShareResponse = 0x12,
  JobNegotiation = 0x20,
  SetDifficulty = 0x21,
  SetTarget = 0x22,
  Ping = 0xF0,
  Pong = 0xF1,
  Error = 0xFF,
}

export enum V2Algo {
  SHA256d = 0x00,
  RandomX = 0x01,
  ProgPoW = 0x02,
  KawPoW = 0x03,
  Ethash = 0x04,
  X11 = 0x05,
}

export interface V2SetupConnection {
  minVersion: number;
  maxVersion: number;
  flags: number;
}

export interface V2SetupConnectionSuccess {
  version: number;
  flags: number;
  serverName: string;
}

export interface V2NewMiningJob {
  jobId: number;
  prevHash: Uint8Array;
  target: Uint8Array;
  blockNumber: number;
  nbits: number;
  algo: V2Algo;
  cleanJobs: boolean;
}

export interface V2SubmitShareResponse {
  jobId: number;
  accepted: boolean;
  errorCode: number;
}

// ─── Frame Encoding ─────────────────────────────────────────────────────

export function encodeV2Frame(msgType: V2MsgType, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(6);
  // protocol_id = 0x0002 (big-endian u16)
  header[0] = (V2_PROTOCOL_ID >> 8) & 0xff;
  header[1] = V2_PROTOCOL_ID & 0xff;
  header[2] = msgType;
  // msg_length (big-endian u24)
  header[3] = (payload.length >> 16) & 0xff;
  header[4] = (payload.length >> 8) & 0xff;
  header[5] = payload.length & 0xff;

  const frame = new Uint8Array(6 + payload.length);
  frame.set(header);
  frame.set(payload, 6);
  return frame;
}

export function decodeV2Frame(data: Uint8Array): { msgType: V2MsgType; payload: Uint8Array } | null {
  if (data.length < 6) return null;
  const protocolId = (data[0] << 8) | data[1];
  if (protocolId !== V2_PROTOCOL_ID) return null;

  const msgType = data[2] as V2MsgType;
  const msgLength = (data[3] << 16) | (data[4] << 8) | data[5];
  if (data.length < 6 + msgLength) return null;

  return { msgType, payload: data.slice(6, 6 + msgLength) };
}

export function isV2Frame(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  return ((data[0] << 8) | data[1]) === V2_PROTOCOL_ID;
}

// ─── Payload Encoders ───────────────────────────────────────────────────

export function encodeSetupConnection(minVersion: number, maxVersion: number, flags: number): Uint8Array {
  const buf = new Uint8Array(8);
  buf[0] = (minVersion >> 8) & 0xff;
  buf[1] = minVersion & 0xff;
  buf[2] = (maxVersion >> 8) & 0xff;
  buf[3] = maxVersion & 0xff;
  buf[4] = (flags >> 24) & 0xff;
  buf[5] = (flags >> 16) & 0xff;
  buf[6] = (flags >> 8) & 0xff;
  buf[7] = flags & 0xff;
  return buf;
}

export function decodeSetupConnectionSuccess(payload: Uint8Array): V2SetupConnectionSuccess {
  const version = (payload[0] << 8) | payload[1];
  const flags = (payload[2] << 24) | (payload[3] << 16) | (payload[4] << 8) | payload[5];
  const serverName = new TextDecoder().decode(payload.slice(6));
  return { version, flags, serverName };
}

export function decodeNewMiningJob(payload: Uint8Array): V2NewMiningJob {
  let offset = 0;
  const jobId = (payload[offset] << 24) | (payload[offset + 1] << 16) | (payload[offset + 2] << 8) | payload[offset + 3];
  offset += 4;
  const prevHash = payload.slice(offset, offset + 32); offset += 32;
  const target = payload.slice(offset, offset + 32); offset += 32;
  const blockNumber = (payload[offset] << 24) | (payload[offset + 1] << 16) | (payload[offset + 2] << 8) | payload[offset + 3];
  offset += 4;
  const nbits = (payload[offset] << 24) | (payload[offset + 1] << 16) | (payload[offset + 2] << 8) | payload[offset + 3];
  offset += 4;
  const algo = payload[offset] as V2Algo; offset += 1;
  const cleanJobs = payload[offset] === 1;
  return { jobId, prevHash, target, blockNumber, nbits, algo, cleanJobs };
}

export function encodeSubmitShare(jobId: number, nonce: bigint, algo: V2Algo): Uint8Array {
  const buf = new Uint8Array(13);
  buf[0] = (jobId >> 24) & 0xff;
  buf[1] = (jobId >> 16) & 0xff;
  buf[2] = (jobId >> 8) & 0xff;
  buf[3] = jobId & 0xff;
  for (let i = 0; i < 8; i++) {
    buf[4 + i] = Number((nonce >> BigInt(i * 8)) & 0xFFn);
  }
  buf[12] = algo;
  return buf;
}

export function decodeSubmitShareResponse(payload: Uint8Array): V2SubmitShareResponse {
  const jobId = (payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3];
  const accepted = payload[4] === 1;
  const errorCode = payload[5];
  return { jobId, accepted, errorCode };
}

export function decodeSetDifficulty(payload: Uint8Array): bigint {
  let diff = 0n;
  for (let i = 0; i < 8; i++) {
    diff = (diff << 8n) | BigInt(payload[i]);
  }
  return diff;
}

export function encodeJobNegotiation(desiredDifficulty: bigint, algo: V2Algo): Uint8Array {
  const buf = new Uint8Array(9);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number((desiredDifficulty >> BigInt((7 - i) * 8)) & 0xFFn);
  }
  buf[8] = algo;
  return buf;
}

// ─── Exported Noise IK Initiator ─────────────────────────────────────────

export { NoiseIKInitiator };
