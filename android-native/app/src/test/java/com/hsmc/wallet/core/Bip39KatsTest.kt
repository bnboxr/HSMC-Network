package com.hsmc.wallet.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Known-answer tests for the BIP39 implementation (R11: real BIP39 checksum +
 * test vectors). The wordlist is loaded from the shipped resource file on disk,
 * exactly like the app loads it at runtime (via [Wordlist.loadFromLines]).
 */
class Bip39KatsTest {

    private val words: List<String> by lazy {
        Wordlist.loadFromLines(
            File("src/main/res/raw/words.txt").readLines()
        )
    }

    private val m12 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    private val m24 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"

    @Test
    fun `12-word all-zero vector validates`() {
        val result = Bip39Mnemonic.validate(m12, words)
        assertEquals(Bip39Mnemonic.Validation.Valid(12), result)
    }

    @Test
    fun `24-word all-zero vector validates`() {
        val result = Bip39Mnemonic.validate(m24, words)
        assertEquals(Bip39Mnemonic.Validation.Valid(24), result)
    }

    @Test
    fun `fromEntropy reproduces the all-zero vectors`() {
        val e12 = ByteArray(16) // 128-bit entropy of zeros
        val e24 = ByteArray(32) // 256-bit entropy of zeros
        assertEquals(m12, Bip39Mnemonic.fromEntropy(e12, words))
        assertEquals(m24, Bip39Mnemonic.fromEntropy(e24, words))
    }

    @Test
    fun `generated mnemonic round-trips`() {
        val mnemonic = Bip39Mnemonic.generate(words, 128)
        assertEquals(Bip39Mnemonic.Validation.Valid(12), Bip39Mnemonic.validate(mnemonic, words))
        val mnemonic256 = Bip39Mnemonic.generate(words, 256)
        assertEquals(Bip39Mnemonic.Validation.Valid(24), Bip39Mnemonic.validate(mnemonic256, words))
    }

    @Test
    fun `toSeed matches the published TREZOR vector`() {
        // BIP39 spec vector: mnemonic + passphrase "TREZOR".
        val seed = Bip39Mnemonic.toSeed(m12, "TREZOR")
        assertEquals(
            "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04",
            seed.joinToString("") { "%02x".format(it) }
        )
    }

    @Test
    fun `wrong word count is rejected`() {
        val result = Bip39Mnemonic.validate("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon", words)
        assertTrue(result is Bip39Mnemonic.Validation.WrongWordCount)
    }

    @Test
    fun `unknown word is rejected`() {
        val result = Bip39Mnemonic.validate("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notaword", words)
        assertEquals(Bip39Mnemonic.Validation.UnknownWord("notaword"), result)
    }

    @Test
    fun `bad checksum is rejected`() {
        // Same first 11 words, last word changed from "about" to "abandon" → wrong checksum.
        val bad = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon"
        val result = Bip39Mnemonic.validate(bad, words)
        assertEquals(Bip39Mnemonic.Validation.BadChecksum(12), result)
    }
}
