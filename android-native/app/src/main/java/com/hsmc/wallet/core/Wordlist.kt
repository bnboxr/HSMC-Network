package com.hsmc.wallet.core

import android.content.Context
import com.hsmc.wallet.R

/**
 * Loads and validates the BIP39 English wordlist shipped as a raw resource
 * (res/raw/words.txt, the official 2048-word list from bitcoin/bips).
 *
 * The loader refuses to operate on a corrupt resource: it requires exactly 2048
 * unique, non-empty words in alphabetical order (the official list is sorted).
 */
object Wordlist {
    const val EXPECTED_SIZE: Int = 2048

    /**
     * Loads the wordlist from raw lines (public so unit tests can feed the same file
     * from disk — the resource lookup needs an Android Context).
     */
    fun loadFromLines(lines: List<String>): List<String> {
        val words = lines
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
        require(words.size == EXPECTED_SIZE) {
            "BIP39 wordlist must have $EXPECTED_SIZE words, got ${words.size}"
        }
        require(words == words.sorted()) { "BIP39 English wordlist must be alphabetically sorted" }
        require(words.size == words.distinct().size) { "BIP39 wordlist contains duplicates" }
        return words
    }

    /**
     * Loads the wordlist. Throws [IllegalStateException] if the resource is missing,
     * truncated, duplicated, or out of order.
     */
    fun load(context: Context): List<String> {
        val lines = context.resources
            .openRawResource(R.raw.words)
            .bufferedReader(Charsets.US_ASCII)
            .use { it.readLines() }
        return loadFromLines(lines)
    }
}
