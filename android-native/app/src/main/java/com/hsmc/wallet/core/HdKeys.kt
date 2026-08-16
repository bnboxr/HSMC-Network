package com.hsmc.wallet.core

import org.bouncycastle.crypto.digests.KeccakDigest
import java.math.BigInteger
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * HSMC hierarchical key derivation, mirroring `rust-node/hsmc-crypto/src/hd_keys.rs`
 * exactly:
 *
 *  - master:  IL || IR = HMAC-SHA512("HSMC Mainnet seed", bip39Seed)
 *  - path:    m/44'/8888'/0'/0/0
 *  - child:   hardened  → HMAC-SHA512(chainCode, 0x00 || parentSk || indexBE)
 *             normal    → HMAC-SHA512(chainCode, parentPubkey || indexBE)
 *             childSk = (IL + parentSk) mod L
 *  - pubkey:  childSk * RISTRETTO_BASEPOINT, compressed (32 bytes)
 *  - address: "HSMC" + hex(keccak256("HSMC_ADDR_V2_" || pubkey)[12..32])
 *
 * Deviation from the Rust implementation (documented deliberately): the node uses
 * `Scalar::from_canonical_bytes` and errors out when an HMAC output is not a canonical
 * scalar (≈1/256 of all seeds at the master step — the "abandon…about" test vector
 * hits exactly this). The wallet reduces mod L instead ([reduceScalar]), which is the
 * standard BIP32 behavior and never rejects a valid seed.
 */
object HdKeys {

    private const val HMAC_ALGORITHM: String = "HmacSHA512"
    private val MAINNET_TAG: ByteArray = "HSMC Mainnet seed".toByteArray(Charsets.UTF_8)

    /** HSMC BIP44 coin type (matches the node's COIN_TYPE_HSMC). */
    const val COIN_TYPE_HSMC: Long = 8888
    private const val HARDENED_OFFSET: Long = 0x80000000L

    /** Standard first account path m/44'/8888'/0'/0/0. */
    private val ACCOUNT_PATH: LongArray = longArrayOf(
        44 + HARDENED_OFFSET,
        COIN_TYPE_HSMC + HARDENED_OFFSET,
        0 + HARDENED_OFFSET,
        0,
        0
    )

    /** Reduces a 32-byte little-endian value modulo the Ristretto group order L. */
    fun reduceScalar(bytes: ByteArray): BigInteger {
        var v = BigInteger.ZERO
        for (i in 31 downTo 0) {
            v = v.shiftLeft(8).or(BigInteger.valueOf(bytes[i].toLong() and 0xFF))
        }
        return v.mod(Ristretto255.L)
    }

    /** 32-byte little-endian encoding of a scalar. */
    fun scalarToBytes(s: BigInteger): ByteArray {
        val m = s.mod(Ristretto255.L)
        val bytes = ByteArray(32)
        var value = m
        for (i in 0 until 32) {
            bytes[i] = value.and(BigInteger.valueOf(0xFF)).toInt().toByte()
            value = value.shiftRight(8)
        }
        return bytes
    }

    private fun hmacSha512(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance(HMAC_ALGORITHM)
        mac.init(SecretKeySpec(key, HMAC_ALGORITHM))
        return mac.doFinal(data)
    }

    /** Master key from the BIP39 seed: (masterSecret, masterChainCode). */
    fun masterFromSeed(seed: ByteArray): Pair<ByteArray, ByteArray> {
        // N1 (security review): `out` holds the full HMAC-SHA512 output whose first half
        // is the master IL — seed-equivalent key material. Copy the two halves into the
        // return values, then zeroize the intermediate buffer in `finally` so a crash or
        // GC snapshot cannot leave a seed-equivalent secret in memory. The returned
        // copies are deliberately NOT cleared (callers own them).
        val out = hmacSha512(MAINNET_TAG, seed)
        try {
            return out.copyOfRange(0, 32) to out.copyOfRange(32, 64)
        } finally {
            out.fill(0)
        }
    }

    /**
     * BIP32 child derivation. [index] uses the full child number (with the hardened
     * offset bit set for hardened derivation), matching the node's `PathComponent`.
     */
    fun deriveChild(sk: ByteArray, chainCode: ByteArray, index: Long): Pair<ByteArray, ByteArray> {
        require(sk.size == 32 && chainCode.size == 32) { "sk and chain code must be 32 bytes" }
        val hardened = index >= HARDENED_OFFSET
        val data = java.io.ByteArrayOutputStream(37)
        if (hardened) {
            data.write(0x00)
            data.write(sk)
        } else {
            data.write(publicKeyBytes(sk))
        }
        val indexBytes = ByteArray(4)
        for (i in 0 until 4) {
            indexBytes[3 - i] = ((index ushr (8 * i)) and 0xFF).toByte()
        }
        data.write(indexBytes)

        // N1 (security review): `data` contains the parent secret scalar for hardened
        // steps, and `out`/`il` hold the HMAC output (child IL = child secret tweak).
        // All three are zeroized in `finally`; only the returned values (child scalar
        // and new chain code) survive, mirroring deriveAddress's pattern.
        val dataBytes = data.toByteArray()
        var out: ByteArray? = null
        var il: ByteArray? = null
        try {
            out = hmacSha512(chainCode, dataBytes)
            il = out.copyOfRange(0, 32)
            val ir = out.copyOfRange(32, 64)
            val child = reduceScalar(il).add(reduceScalar(sk)).mod(Ristretto255.L)
            return scalarToBytes(child) to ir
        } finally {
            out?.fill(0)
            il?.fill(0)
            dataBytes.fill(0)
        }
    }

    /** 32-byte compressed Ristretto public key for a secret scalar. */
    fun publicKeyBytes(sk: ByteArray): ByteArray {
        require(sk.size == 32) { "secret key must be 32 bytes" }
        return Ristretto255.compress(Ristretto255.scalarMultBase(sk))
    }

    /** Keccak-256 (BouncyCastle, the same digest the node's `sha3::Keccak256` implements). */
    fun keccak256(data: ByteArray): ByteArray {
        val digest = KeccakDigest(256)
        digest.update(data, 0, data.size)
        val out = ByteArray(32)
        digest.doFinal(out, 0)
        return out
    }

    /**
     * HSMC address from a compressed public key: "HSMC" + hex(keccak256(
     * "HSMC_ADDR_V2_" || pubkey)[12..32]) — matches the node's
     * `Address::from_pubkey_bytes` (44 characters, lowercase hex).
     */
    fun addressFromPubkey(pubkey: ByteArray): String {
        val prefix = "HSMC_ADDR_V2_".toByteArray(Charsets.US_ASCII)
        val full = keccak256(prefix + pubkey)
        val hex = full.copyOfRange(12, 32).joinToString("") { "%02x".format(it) }
        return "HSMC$hex"
    }

    /**
     * Derives the wallet's first address (m/44'/8888'/0'/0/0) from the BIP39 seed.
     * The seed bytes are NOT modified; callers must zeroize their own copy.
     */
    fun deriveAddress(seed: ByteArray): String {
        var (sk, cc) = masterFromSeed(seed)
        try {
            for (index in ACCOUNT_PATH) {
                val (nsk, ncc) = deriveChild(sk, cc, index)
                // Overwrite the old secret scalar before replacing the reference.
                sk.fill(0)
                sk = nsk
                cc = ncc
            }
            val pubkey = publicKeyBytes(sk)
            return addressFromPubkey(pubkey)
        } finally {
            sk.fill(0)
            cc.fill(0)
        }
    }
}
