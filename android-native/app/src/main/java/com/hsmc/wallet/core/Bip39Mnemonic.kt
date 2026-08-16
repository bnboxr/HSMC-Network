package com.hsmc.wallet.core

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Real BIP-39 implementation (https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki).
 *
 * This is intentionally NOT a copy of the legacy `src/utils/bip39-wallet.ts` from the web
 * app, which was audited as non-standard (it used a "checksum" of sum(indices) % 2048 and a
 * non-standard 25-word scheme). Here:
 *  - entropy -> mnemonic uses the real BIP39 index split (11-bit groups) and a SHA-256
 *    checksum of the entropy (first ENT/32 bits).
 *  - mnemonic -> seed uses PBKDF2-HMAC-SHA512 with 2048 iterations and salt "mnemonic"
 *    (+ optional passphrase, empty by default).
 *  - validation recomputes the checksum from the word indices; it does not just count words.
 */
object Bip39Mnemonic {

    /** Number of PBKDF2 iterations mandated by BIP-39. */
    const val PBKDF2_ITERATIONS: Int = 2048

    /** JCA algorithm string for PBKDF2-HMAC-SHA512 (available on Android API 26+). */
    const val PBKDF2_ALGORITHM: String = "PBKDF2WithHmacSHA512"

    /** Valid BIP39 entropy sizes in bits (12/15/18/21/24 words). */
    val VALID_ENTROPY_BITS: IntArray = intArrayOf(128, 160, 192, 224, 256)

    /** Valid mnemonic word counts (they follow from the entropy sizes above). */
    val VALID_WORD_COUNTS: IntArray = intArrayOf(12, 15, 18, 21, 24)

    /**
     * Generates a fresh random mnemonic using the device SecureRandom.
     *
     * @param words      the loaded BIP39 English wordlist (see [Wordlist.load]).
     * @param strengthBits entropy size in bits; one of [VALID_ENTROPY_BITS].
     */
    fun generate(words: List<String>, strengthBits: Int = 256): String {
        require(strengthBits in VALID_ENTROPY_BITS) {
            "Invalid BIP39 strength $strengthBits; valid: ${VALID_ENTROPY_BITS.joinToString()}"
        }
        val entropy = ByteArray(strengthBits / 8)
        SecureRandom().nextBytes(entropy)
        return fromEntropy(entropy, words)
    }

    /**
     * Converts raw entropy to a BIP39 mnemonic (real algorithm).
     *
     * @param entropy 16/20/24/28/32 bytes of entropy.
     * @param words   the loaded BIP39 English wordlist (2048 words).
     */
    fun fromEntropy(entropy: ByteArray, words: List<String>): String {
        require(entropy.size in intArrayOf(16, 20, 24, 28, 32)) {
            "Entropy must be 16/20/24/28/32 bytes, got ${entropy.size}"
        }
        require(words.size == 2048) { "BIP39 wordlist must contain exactly 2048 words" }

        val entBits = entropy.size * 8
        val checksumBits = entBits / 32
        val totalBits = entBits + checksumBits
        require(totalBits % 11 == 0) { "BIP39 invariant violated: $totalBits bits not divisible by 11" }

        // Real BIP39 checksum: first (ENT/32) bits of SHA-256(entropy).
        val hash = MessageDigest.getInstance("SHA-256").digest(entropy)

        // Flatten entropy + checksum into a bit array.
        val bits = BooleanArray(totalBits)
        for (i in entropy.indices) {
            val byte = entropy[i].toInt() and 0xFF
            for (b in 0 until 8) {
                bits[i * 8 + b] = (byte ushr (7 - b)) and 1 == 1
            }
        }
        for (b in 0 until checksumBits) {
            bits[entBits + b] = (hash[0].toInt() ushr (7 - b)) and 1 == 1
        }

        // Group every 11 bits into a word index.
        val wordCount = totalBits / 11
        val indices = IntArray(wordCount)
        for (i in indices.indices) {
            var index = 0
            for (b in 0 until 11) {
                index = (index shl 1) or (if (bits[i * 11 + b]) 1 else 0)
            }
            indices[i] = index
        }

        return indices.joinToString(" ") { words[it] }
    }

    /**
     * Derives the 64-byte BIP39 seed from a mnemonic using PBKDF2-HMAC-SHA512.
     *
     * @param mnemonic   space-separated BIP39 words (any valid word count).
     * @param passphrase optional BIP39 passphrase; empty string yields the standard salt.
     */
    fun toSeed(mnemonic: String, passphrase: String = ""): ByteArray {
        val normalized = normalize(mnemonic)
        val salt = "mnemonic" + passphrase
        val spec = PBEKeySpec(
            normalized.joinToString(" ").toCharArray(),
            salt.toByteArray(Charsets.UTF_8),
            PBKDF2_ITERATIONS,
            512 // 64 bytes
        )
        return SecretKeyFactory.getInstance(PBKDF2_ALGORITHM).generateSecret(spec).encoded
    }

    /** Outcome of [validate]. */
    sealed interface Validation {
        data class Valid(val wordCount: Int) : Validation
        data class WrongWordCount(val actual: Int) : Validation
        data class UnknownWord(val word: String) : Validation
        data class BadChecksum(val wordCount: Int) : Validation
    }

    /**
     * Validates a mnemonic against the real BIP39 algorithm: word count, membership in the
     * wordlist, and recomputation of the SHA-256 checksum from the reconstructed entropy.
     */
    fun validate(mnemonic: String, words: List<String>): Validation {
        val normalized = normalize(mnemonic)
        if (normalized.size !in VALID_WORD_COUNTS) {
            return Validation.WrongWordCount(normalized.size)
        }

        val indexOfWord = words.withIndex().associate { (i, w) -> w to i }
        val indices = IntArray(normalized.size)
        for ((i, word) in normalized.withIndex()) {
            val idx = indexOfWord[word]
            if (idx == null) return Validation.UnknownWord(word)
            indices[i] = idx
        }

        val totalBits = normalized.size * 11
        val checksumBits = normalized.size / 3 // ENT = totalBits - checksumBits; CS = ENT/32 => CS = wordCount/3
        val entBits = totalBits - checksumBits

        // Reconstruct the bit array from indices.
        val bits = BooleanArray(totalBits)
        for (i in indices.indices) {
            val idx = indices[i]
            for (b in 0 until 11) {
                bits[i * 11 + b] = (idx ushr (10 - b)) and 1 == 1
            }
        }

        // Reconstruct entropy bytes.
        val entropy = ByteArray(entBits / 8)
        for (i in entropy.indices) {
            var byte = 0
            for (b in 0 until 8) {
                byte = (byte shl 1) or (if (bits[i * 8 + b]) 1 else 0)
            }
            entropy[i] = byte.toByte()
        }

        // Compare stored checksum bits with SHA-256(entropy) leading bits.
        val hash = MessageDigest.getInstance("SHA-256").digest(entropy)
        for (b in 0 until checksumBits) {
            val expected = ((hash[0].toInt() ushr (7 - b)) and 1) == 1
            if (bits[entBits + b] != expected) {
                return Validation.BadChecksum(normalized.size)
            }
        }
        return Validation.Valid(normalized.size)
    }

    /**
     * Normalizes user input: trims, lowercases, splits on any whitespace, drops empties.
     */
    fun normalize(mnemonic: String): List<String> =
        mnemonic.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
}
