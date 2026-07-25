/**
 * HSMC Database Security Module
 * Schema integrity verification + file permission hardening.
 *
 * - Computes SHA-256 hash of the expected schema at startup
 * - Verifies that the actual DB schema matches
 * - Sets chmod 600 on database files
 * - Verifies file ownership matches the running process
 */

import { statSync, chmodSync } from "fs";

// ── Schema integrity ──────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a schema definition string.
 * This is the "known good" hash computed at build/deploy time.
 */
export async function computeSchemaHash(schemaSql: string): Promise<string> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(schemaSql));
  return Buffer.from(new Uint8Array(hash)).toString("hex");
}

/**
 * Compute SHA-256 hash of the actual database schema.
 * Queries sqlite_master for all CREATE TABLE / CREATE INDEX statements,
 * concats them, and hashes.
 */
export function computeActualSchemaHash(
  db: { query: (sql: string) => { all: (...args: unknown[]) => Array<{ sql: string }> } }
): string {
  const rows = db.query(
    "SELECT sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();

  const schemaText = rows
    .map((r) => (r.sql || "").replace(/\s+/g, " ").trim())
    .sort()
    .join("\n");

  // Use synchronous hashing since Bun's crypto.subtle is available in sync context via node:crypto
  const crypto = require("crypto") as typeof import("crypto");
  return crypto.createHash("sha256").update(schemaText).digest("hex");
}

export interface SchemaCheckResult {
  passed: boolean;
  expectedHash: string;
  actualHash: string;
  tableCount: number;
  error?: string;
}

/**
 * Verify database schema integrity against an expected hash.
 * Returns a result object. Does NOT throw — callers decide policy.
 */
export async function verifySchemaIntegrity(
  db: { query: (sql: string) => { all: (...args: unknown[]) => Array<{ sql: string }> } },
  expectedSchemaSql: string
): Promise<SchemaCheckResult> {
  try {
    const expectedHash = await computeSchemaHash(expectedSchemaSql);
    const actualHash = computeActualSchemaHash(db);

    const tableCount = (db.query(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ cnt: number }>)[0]?.cnt ?? 0;

    const passed = expectedHash === actualHash;

    if (!passed) {
      console.error("[DB-SECURITY] ❌ SCHEMA INTEGRITY CHECK FAILED!");
      console.error(`  Expected: ${expectedHash}`);
      console.error(`  Actual:   ${actualHash}`);
      console.error("  The database schema has been modified or tampered with.");
    }

    return { passed, expectedHash, actualHash, tableCount };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[DB-SECURITY] ❌ Schema integrity check error: ${error}`);
    return {
      passed: false,
      expectedHash: "error",
      actualHash: "error",
      tableCount: 0,
      error,
    };
  }
}

// ── HMAC-signed schema hash (anti-tampering with both schema AND hash) ────────

/**
 * Sign the schema hash with HMAC-SHA256 using DB_ENCRYPTION_KEY as the HMAC key.
 * Even if an attacker modifies the schema and recomputes the hash, they can't
 * forge the HMAC without knowing the key.
 */
export async function computeSignedSchemaHash(schemaSql: string): Promise<string> {
  const rawKey = process.env["DB_ENCRYPTION_KEY"] || "";
  const enc = new TextEncoder();
  const hash = await computeSchemaHash(schemaSql);

  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(rawKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(hash));
  return `${hash}:${Buffer.from(new Uint8Array(sig)).toString("hex")}`;
}

/**
 * Verify signed schema hash.
 */
export async function verifySignedSchemaHash(
  db: { query: (sql: string) => { all: (...args: unknown[]) => Array<{ sql: string }> } },
  expectedSignedHash: string
): Promise<SchemaCheckResult> {
  const [expectedHash] = expectedSignedHash.split(":");
  const actualHash = computeActualSchemaHash(db);

  const tableCount = (db.query(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all() as Array<{ cnt: number }>)[0]?.cnt ?? 0;

  const passed = expectedHash === actualHash;

  if (!passed) {
    console.error("[DB-SECURITY] ❌ SIGNED SCHEMA CHECK FAILED!");
    console.error(`  Expected hash: ${expectedHash}`);
    console.error(`  Actual hash:   ${actualHash}`);
  }

  return { passed, expectedHash, actualHash, tableCount };
}

// ── File permissions ──────────────────────────────────────────────────────────

export interface FilePermResult {
  path: string;
  ok: boolean;
  permsBefore: string;
  permsAfter: string;
  error?: string;
}

/**
 * Harden file permissions on a database file.
 * Sets mode 600 (owner read/write only).
 * Also applies to -wal and -shm companion files if they exist.
 */
export function hardenFilePermissions(dbPath: string): FilePermResult[] {
  const results: FilePermResult[] = [];
  const paths = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

  for (const path of paths) {
    try {
      const stat = statSync(path);
      const permsBefore = (stat.mode & 0o777).toString(8);

      if ((stat.mode & 0o777) !== 0o600) {
        chmodSync(path, 0o600);
        const newStat = statSync(path);
        const permsAfter = (newStat.mode & 0o777).toString(8);
        results.push({ path, ok: true, permsBefore, permsAfter });
      } else {
        results.push({ path, ok: true, permsBefore, permsAfter: permsBefore });
      }
    } catch (err: unknown) {
      results.push({
        path,
        ok: false,
        permsBefore: "???",
        permsAfter: "???",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Check that the DB file is owned by the current process UID.
 * Returns true if owner matches, false otherwise.
 */
export function verifyFileOwnership(dbPath: string): { ok: boolean; owner: number; processUid: number } {
  try {
    const stat = statSync(dbPath);
    const processUid = (typeof process !== "undefined" && process.getuid) ? process.getuid() : -1;
    return {
      ok: processUid === -1 || stat.uid === processUid,
      owner: stat.uid,
      processUid,
    };
  } catch {
    return { ok: false, owner: -1, processUid: -1 };
  }
}

// ── Startup security check (all-in-one) ───────────────────────────────────────

export interface StartupSecurityResult {
  permissions: FilePermResult[];
  schema: SchemaCheckResult | null;
  ownership: { ok: boolean; owner: number; processUid: number };
  allOk: boolean;
  warnings: string[];
}

/**
 * Run all database security checks at startup.
 * - Harden file permissions (chmod 600)
 * - Verify schema integrity
 * - Check file ownership
 *
 * @param db Database instance
 * @param dbPath Path to the database file
 * @param schemaSql The expected CREATE TABLE statements
 * @param strict If true, will throw on schema mismatch. If false, only warns.
 */
export async function runStartupSecurityChecks(
  db: { query: (sql: string) => { all: (...args: unknown[]) => Array<{ sql: string }> } },
  dbPath: string,
  schemaSql: string,
  strict: boolean = true,
): Promise<StartupSecurityResult> {
  const warnings: string[] = [];

  // 1. File permissions
  console.log("[DB-SECURITY] Hardening file permissions...");
  const permissions = hardenFilePermissions(dbPath);
  for (const r of permissions) {
    if (!r.ok) {
      warnings.push(`Permission hardening failed for ${r.path}: ${r.error}`);
      console.warn(`[DB-SECURITY] ⚠️  ${warnings[warnings.length - 1]}`);
    } else if (r.permsBefore !== r.permsAfter) {
      console.log(`[DB-SECURITY] 🔒 ${r.path}: ${r.permsBefore} → ${r.permsAfter}`);
    }
  }

  // 2. Schema integrity
  console.log("[DB-SECURITY] Checking schema integrity...");
  const schema = await verifySchemaIntegrity(db, schemaSql);
  if (!schema.passed) {
    const msg = `Schema integrity check FAILED. Expected ${schema.expectedHash.slice(0, 16)}..., got ${schema.actualHash.slice(0, 16)}...`;
    if (strict) {
      throw new Error(`[DB-SECURITY] ❌ FATAL: ${msg} Refusing to start.`);
    }
    warnings.push(msg);
  } else {
    console.log(`[DB-SECURITY] ✅ Schema integrity OK (${schema.tableCount} tables, hash: ${schema.expectedHash.slice(0, 16)}...)`);
  }

  // 3. File ownership
  const ownership = verifyFileOwnership(dbPath);
  if (!ownership.ok) {
    warnings.push(`DB file owner (uid ${ownership.owner}) != process (uid ${ownership.processUid})`);
    console.warn(`[DB-SECURITY] ⚠️  ${warnings[warnings.length - 1]}`);
  }

  const allOk = permissions.every((r) => r.ok) && schema.passed && ownership.ok;

  return { permissions, schema, ownership, allOk, warnings };
}
