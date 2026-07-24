/**
 * Stratum V2 Binary Framing
 *
 * Wire format:
 *   [2 bytes: protocol_id = 0x0002]
 *   [1 byte:  msg_type]
 *   [3 bytes: msg_length (big-endian)]
 *   [N bytes: msg_payload]
 *
 * The first message from a client determines the protocol:
 *   - Bytes 0-1 == 0x0002 → V2 binary
 *   - Byte 0 == '{' (0x7B) → V1 JSON
 */

export const V2_PROTOCOL_ID = 0x0002;

// ─── Message Types ───────────────────────────────────────────────────────────────

export enum V2MsgType {
  // Handshake
  SetupConnection = 0x00,
  SetupConnectionSuccess = 0x01,
  SetupConnectionError = 0x02,

  // Mining
  NewMiningJob = 0x10,
  SubmitShare = 0x11,
  SubmitShareResponse = 0x12,

  // Job negotiation
  JobNegotiation = 0x20,
  SetDifficulty = 0x21,
  SetTarget = 0x22,

  // Keep-alive
  Ping = 0xF0,
  Pong = 0xF1,

  // Error
  Error = 0xFF,
}

// ─── Algorithm IDs ───────────────────────────────────────────────────────────────

export enum V2Algo {
  SHA256d = 0x00,
  RandomX = 0x01,
  ProgPoW = 0x02,
  KawPoW = 0x03,
  Ethash = 0x04,
  X11 = 0x05,
}

// ─── Payload Types ───────────────────────────────────────────────────────────────

export interface V2SetupConnection {
  minVersion: number; // u16
  maxVersion: number; // u16
  flags: number; // u32
  // Followed by optional endpoint host string
  endpointHost?: string;
}

export interface V2SetupConnectionSuccess {
  version: number; // u16
  flags: number; // u32
  serverName: string; // UTF-8 string
}

export interface V2SetupConnectionError {
  errorCode: number; // u8
  errorMessage: string; // UTF-8 string
}

export interface V2NewMiningJob {
  jobId: number; // u32
  prevHash: Buffer; // 32 bytes
  target: Buffer; // 32 bytes
  blockNumber: number; // u32
  nbits: number; // u32
  algo: V2Algo; // u8
  cleanJobs: boolean; // u8 (0 or 1)
}

export interface V2SubmitShare {
  jobId: number; // u32
  nonce: bigint; // u64
  algo: V2Algo; // u8
}

export interface V2SubmitShareResponse {
  jobId: number; // u32
  accepted: boolean; // u8
  errorCode: number; // u8 (0 if accepted)
}

export interface V2JobNegotiation {
  desiredDifficulty: bigint; // u64
  algo: V2Algo; // u8
}

export interface V2SetDifficulty {
  difficulty: bigint; // u64
}

export interface V2SetTarget {
  target: Buffer; // 32 bytes
}

// ─── Frame Encoding ──────────────────────────────────────────────────────────────

/**
 * Encode a V2 message into wire format.
 */
export function encodeV2Frame(msgType: V2MsgType, payload: Buffer): Buffer {
  if (payload.length > 0xffffff) {
    throw new Error(`Payload too large: ${payload.length} > 16MB`);
  }

  const header = Buffer.alloc(6);
  header.writeUInt16BE(V2_PROTOCOL_ID, 0);
  header.writeUInt8(msgType, 2);

  // 3-byte big-endian length
  header[3] = (payload.length >> 16) & 0xff;
  header[4] = (payload.length >> 8) & 0xff;
  header[5] = payload.length & 0xff;

  return Buffer.concat([header, payload]);
}

/**
 * Decode a V2 frame from wire format.
 * Returns { msgType, payload } or null if not a V2 frame.
 */
export function decodeV2Frame(data: Buffer): { msgType: V2MsgType; payload: Buffer } | null {
  if (data.length < 6) return null;

  const protocolId = data.readUInt16BE(0);
  if (protocolId !== V2_PROTOCOL_ID) return null;

  const msgType = data.readUInt8(2) as V2MsgType;
  const msgLength = (data[3] << 16) | (data[4] << 8) | data[5];

  if (data.length < 6 + msgLength) return null;

  const payload = data.subarray(6, 6 + msgLength);
  return { msgType, payload };
}

/**
 * Check if the given buffer starts with a V2 protocol ID.
 */
export function isV2Frame(data: Buffer): boolean {
  if (data.length < 2) return false;
  return data.readUInt16BE(0) === V2_PROTOCOL_ID;
}

// ─── Payload Encoders/Decoders ───────────────────────────────────────────────────

export function encodeSetupConnection(minVersion: number, maxVersion: number, flags: number, endpointHost?: string): Buffer {
  const hostBuf = endpointHost ? Buffer.from(endpointHost, "utf-8") : Buffer.alloc(0);
  const buf = Buffer.alloc(8 + hostBuf.length);
  buf.writeUInt16BE(minVersion, 0);
  buf.writeUInt16BE(maxVersion, 2);
  buf.writeUInt32BE(flags, 4);
  if (hostBuf.length > 0) hostBuf.copy(buf, 8);
  return buf;
}

export function decodeSetupConnection(payload: Buffer): V2SetupConnection {
  const minVersion = payload.readUInt16BE(0);
  const maxVersion = payload.readUInt16BE(2);
  const flags = payload.readUInt32BE(4);
  const endpointHost = payload.length > 8 ? payload.subarray(8).toString("utf-8") : undefined;
  return { minVersion, maxVersion, flags, endpointHost };
}

export function encodeSetupConnectionSuccess(version: number, flags: number, serverName: string): Buffer {
  const nameBuf = Buffer.from(serverName, "utf-8");
  const buf = Buffer.alloc(6 + nameBuf.length);
  buf.writeUInt16BE(version, 0);
  buf.writeUInt32BE(flags, 2);
  nameBuf.copy(buf, 6);
  return buf;
}

export function decodeSetupConnectionSuccess(payload: Buffer): V2SetupConnectionSuccess {
  const version = payload.readUInt16BE(0);
  const flags = payload.readUInt32BE(2);
  const serverName = payload.subarray(6).toString("utf-8");
  return { version, flags, serverName };
}

export function encodeNewMiningJob(job: V2NewMiningJob): Buffer {
  const buf = Buffer.alloc(73);
  buf.writeUInt32BE(job.jobId, 0);
  job.prevHash.copy(buf, 4);
  job.target.copy(buf, 36);
  buf.writeUInt32BE(job.blockNumber, 68);
  // nbits at offset 72? No we already used 68+4=72.
  // job.prevHash(32) + job.target(32) = 64, plus jobId(4) = 4+64=68
  // blockNumber at 68 (4 bytes), nbits at 68+4=72? No.
  // offset 72, but the allocation is 73? Let me recalculate.
  // jobId (4) + prevHash (32) + target (32) + blockNumber (4) + nbits (4) + algo (1) + cleanJobs (1) = 78
  // Hmm wait, I need to reconsider. Let me use a simpler layout:
  // jobId(4) + prevHash(32) + target(32) + blockNumber(4) + nbits(4) + algo(1) + cleanJobs(1)
  return encodeNewMiningJobRaw(job);
}

function encodeNewMiningJobRaw(job: V2NewMiningJob): Buffer {
  const buf = Buffer.alloc(4 + 32 + 32 + 4 + 4 + 1 + 1); // 78
  let offset = 0;
  buf.writeUInt32BE(job.jobId, offset); offset += 4;
  job.prevHash.copy(buf, offset); offset += 32;
  job.target.copy(buf, offset); offset += 32;
  buf.writeUInt32BE(job.blockNumber, offset); offset += 4;
  buf.writeUInt32BE(job.nbits, offset); offset += 4;
  buf.writeUInt8(job.algo, offset); offset += 1;
  buf.writeUInt8(job.cleanJobs ? 1 : 0, offset);
  return buf;
}

export function decodeNewMiningJob(payload: Buffer): V2NewMiningJob {
  let offset = 0;
  const jobId = payload.readUInt32BE(offset); offset += 4;
  const prevHash = payload.subarray(offset, offset + 32); offset += 32;
  const target = payload.subarray(offset, offset + 32); offset += 32;
  const blockNumber = payload.readUInt32BE(offset); offset += 4;
  const nbits = payload.readUInt32BE(offset); offset += 4;
  const algo = payload.readUInt8(offset) as V2Algo; offset += 1;
  const cleanJobs = payload.readUInt8(offset) === 1;
  return { jobId, prevHash, target, blockNumber, nbits, algo, cleanJobs };
}

export function encodeSubmitShare(share: V2SubmitShare): Buffer {
  const buf = Buffer.alloc(4 + 8 + 1); // 13
  buf.writeUInt32BE(share.jobId, 0);
  buf.writeBigUInt64BE(share.nonce, 4);
  buf.writeUInt8(share.algo, 12);
  return buf;
}

export function decodeSubmitShare(payload: Buffer): V2SubmitShare {
  const jobId = payload.readUInt32BE(0);
  const nonce = payload.readBigUInt64BE(4);
  const algo = payload.readUInt8(12) as V2Algo;
  return { jobId, nonce, algo };
}

export function encodeSubmitShareResponse(jobId: number, accepted: boolean, errorCode: number = 0): Buffer {
  const buf = Buffer.alloc(6);
  buf.writeUInt32BE(jobId, 0);
  buf.writeUInt8(accepted ? 1 : 0, 4);
  buf.writeUInt8(errorCode, 5);
  return buf;
}

export function decodeSubmitShareResponse(payload: Buffer): V2SubmitShareResponse {
  const jobId = payload.readUInt32BE(0);
  const accepted = payload.readUInt8(4) === 1;
  const errorCode = payload.readUInt8(5);
  return { jobId, accepted, errorCode };
}

export function encodeSetDifficulty(difficulty: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(difficulty, 0);
  return buf;
}

export function decodeSetDifficulty(payload: Buffer): V2SetDifficulty {
  const difficulty = payload.readBigUInt64BE(0);
  return { difficulty };
}

export function encodeJobNegotiation(desiredDifficulty: bigint, algo: V2Algo): Buffer {
  const buf = Buffer.alloc(9);
  buf.writeBigUInt64BE(desiredDifficulty, 0);
  buf.writeUInt8(algo, 8);
  return buf;
}

export function decodeJobNegotiation(payload: Buffer): V2JobNegotiation {
  const desiredDifficulty = payload.readBigUInt64BE(0);
  const algo = payload.readUInt8(8) as V2Algo;
  return { desiredDifficulty, algo };
}
