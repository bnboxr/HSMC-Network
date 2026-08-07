/**
 * HSMC Database Column-Level Encryption
 * AES-256-GCM encryption for sensitive database columns.
 *
 * Uses Web Crypto API (available in Bun) — no external dependencies.
 * Key is derived from DB_ENCRYPTION_KEY environment variable via PBKDF2.
 *
 * Encrypted format: base64(iv):base64(ciphertext+tag)
 *   - 12-byte random IV (GCM standard)
 *   - 16-byte authentication tag (appended to ciphertext by GCM)
 */

const ENCRYPTION_KEY_ENV = "DB_ENCRYPTION_KEY";
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT = new Uint8Array([
  0x48, 0x53, 0x4d, 0x43, 0x5f, 0x44, 0x42, 0x5f,
  0x45, 0x4e, 0x43, 0x52, 0x59, 0x50, 0x54, 0x00,
]); // "HSMC_DB_ENCRYPT\0" — fixed salt for key derivation

let _encryptionKey: CryptoKey | null = null;
let _keyInitialized = false;
let _keyInitError: string | null = null;

/** Derive AES-256-GCM key from raw secret string */
async function deriveKey(rawKey: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(rawKey),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: PBKDF2_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Initialize the encryption key. Must be called once at startup. */
export async function initEncryptionKey(): Promise<void> {
  if (_keyInitialized) return;

  const rawKey = process.env[ENCRYPTION_KEY_ENV] || "";

  if (!rawKey || rawKey.length < 16) {
    _keyInitError = `DB_ENCRYPTION_KEY is not set or too short (< 16 chars).`;
    _keyInitialized = true;
    if (process.env.NODE_ENV === "production") throw new Error(`[DB-CRYPTO] ${_keyInitError} Production startup aborted.`);
    console.warn(`[DB-CRYPTO] ⚠️  ${_keyInitError} Encryption unavailable in development.`);
    return;
  }

  try {
    _encryptionKey = await deriveKey(rawKey);
    console.log("[DB-CRYPTO] ✅ AES-256-GCM encryption key initialized");
  } catch (err: unknown) {
    _keyInitError = `Failed to derive encryption key: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[DB-CRYPTO] ❌ ${_keyInitError}`);
  }

  _keyInitialized = true;
}

/** Check if encryption is available */
export function isEncryptionAvailable(): boolean {
  return _keyInitialized && _encryptionKey !== null;
}

/** Get initialization error (if any) */
export function getEncryptionInitError(): string | null {
  return _keyInitError;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns format: "base64(iv):base64(ciphertext+tag)"
 * If encryption is not available, throws rather than storing plaintext.
 */
export async function encryptField(plaintext: string): Promise<string> {
  if (!_encryptionKey) {
    throw new Error("[DB-CRYPTO] Encryption key unavailable; refusing to store plaintext");
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    _encryptionKey,
    enc.encode(plaintext)
  );

  const ivB64 = Buffer.from(iv).toString("base64");
  const ctB64 = Buffer.from(new Uint8Array(ciphertext)).toString("base64");
  return `${ivB64}:${ctB64}`;
}

/**
 * Decrypt a ciphertext string produced by encryptField.
 * Legacy plaintext values are rejected in production.
 * If encryption is not available and string doesn't have "PLAINTEXT:" prefix,
 * returns the original string (backward compat with pre-encryption data).
 */
export async function decryptField(ciphertext: string): Promise<string> {
  // Handle legacy plaintext marker
  if (ciphertext.startsWith("PLAINTEXT:")) {
    if (process.env.NODE_ENV === "production") throw new Error("[DB-CRYPTO] Refusing legacy plaintext value in production");
    return ciphertext.slice(10);
  }

  if (!_encryptionKey) {
    if (process.env.NODE_ENV === "production") throw new Error("[DB-CRYPTO] Encryption key unavailable; refusing plaintext fallback");
    return ciphertext;
  }

  const colonIdx = ciphertext.indexOf(":");
  if (colonIdx < 0) {
    if (process.env.NODE_ENV === "production") throw new Error("[DB-CRYPTO] Refusing legacy plaintext data in production");
    return ciphertext;
  }

  try {
    const ivB64 = ciphertext.substring(0, colonIdx);
    const ctB64 = ciphertext.substring(colonIdx + 1);
    const iv = new Uint8Array(Buffer.from(ivB64, "base64"));
    const ct = new Uint8Array(Buffer.from(ctB64, "base64"));

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      _encryptionKey,
      ct
    );
    return new TextDecoder().decode(plaintext);
  } catch (err: unknown) {
    if (process.env.NODE_ENV === "production") throw new Error("[DB-CRYPTO] Decryption failed; refusing plaintext fallback");
    console.warn(`[DB-CRYPTO] decryptField failed in development: ${err instanceof Error ? err.message : String(err)}`);
    return ciphertext;
  }
}

/** Synchronous wrapper for encryptField — schedules async, returns Promise */
export function encryptFieldSync(plaintext: string): Promise<string> {
  return encryptField(plaintext);
}

/** Synchronous wrapper for decryptField — schedules async, returns Promise */
export function decryptFieldSync(ciphertext: string): Promise<string> {
  return decryptField(ciphertext);
}

// ── Sensitive column map ──────────────────────────────────────────────────────
// Maps "table.column" → true for columns that must be encrypted at rest.
export const ENCRYPTED_COLUMNS: Record<string, boolean> = {
  "totp_secrets.secret": true,
  "payment_sessions.stripe_client_secret": true,
  "payment_sessions.otp_code": true,
  // wallet_seeds.encrypted_seed is already encrypted at app level
  // users.password_hash is already PBKDF2-hashed
  // webauthn_credentials.public_key is a public key — no need to encrypt
};

/** Check if a given table.column pair requires encryption */
export function isEncryptedColumn(table: string, column: string): boolean {
  return ENCRYPTED_COLUMNS[`${table}.${column}`] === true;
}

/** Get all encrypted columns for a table */
export function getEncryptedColumnsForTable(table: string): string[] {
  const prefix = `${table}.`;
  return Object.keys(ENCRYPTED_COLUMNS)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}
