package com.hsmc.wallet.core

import android.content.Context
import android.content.SharedPreferences

/**
 * Persists the wallet seed as ciphertext only.
 *
 * The BIP39 seed (64 bytes, derived via [Bip39Mnemonic.toSeed]) is encrypted with
 * AES-256-GCM by an Android Keystore key ([AndroidKeyStoreWrapper.SEED_ALIAS]) and the
 * resulting base64 blob is stored in a dedicated SharedPreferences file. Only ciphertext
 * ever touches disk; the plaintext seed exists solely in process memory.
 *
 * Biometric protection mode:
 *  - disabled (default): the seed key is a plain Keystore AES key.
 *  - enabled: the seed key is created with strong-biometric binding; [loadSeed] then
 *    requires the user to authenticate through BiometricPrompt before the key unlocks.
 *
 * Switching modes decrypts the current seed, deletes the old key, and re-encrypts under a
 * newly created key with the target protection ([AndroidKeyStoreWrapper.createKey]).
 */
object WalletStorage {

    private const val PREFS_FILE: String = "hsmc_wallet_vault"
    private const val KEY_ENCRYPTED_SEED: String = "encrypted_seed"
    private const val KEY_WORD_COUNT: String = "word_count" // metadata only (12/15/18/21/24)

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    /** True when an encrypted seed blob exists on this device. */
    fun walletExists(context: Context): Boolean =
        prefs(context).contains(KEY_ENCRYPTED_SEED)

    /** Number of words the wallet was created with (for display only). */
    fun wordCount(context: Context): Int = prefs(context).getInt(KEY_WORD_COUNT, 0)

    /**
     * Validates [mnemonic] (real BIP39), derives the seed, encrypts it under the seed key
     * with the requested [biometricProtected] mode and stores the ciphertext.
     *
     * @return the number of words in the mnemonic, or throws
     *   [IllegalArgumentException] when the mnemonic is invalid.
     */
    fun saveWallet(
        context: Context,
        mnemonic: String,
        biometricProtected: Boolean = false
    ): Int {
        val words = Wordlist.load(context)
        when (val result = Bip39Mnemonic.validate(mnemonic, words)) {
            is Bip39Mnemonic.Validation.Valid -> {
                val seed = Bip39Mnemonic.toSeed(mnemonic)
                val encrypted = AndroidKeyStoreWrapper.encrypt(
                    alias = AndroidKeyStoreWrapper.SEED_ALIAS,
                    plaintext = seed,
                    biometricProtected = biometricProtected
                )
                prefs(context).edit()
                    .putString(KEY_ENCRYPTED_SEED, encrypted)
                    .putInt(KEY_WORD_COUNT, result.wordCount)
                    .apply()
                SecurePrefs(context).putBoolean(SecurePrefs.KEY_WALLET_CREATED, true)
                SecurePrefs(context).putBoolean(SecurePrefs.KEY_BIOMETRIC_ENABLED, biometricProtected)
                return result.wordCount
            }
            is Bip39Mnemonic.Validation.WrongWordCount ->
                throw IllegalArgumentException(
                    "A BIP39 mnemonic has ${Bip39Mnemonic.VALID_WORD_COUNTS.joinToString("/")} words; got ${result.actual}"
                )
            is Bip39Mnemonic.Validation.UnknownWord ->
                throw IllegalArgumentException("\"${result.word}\" is not in the BIP39 English wordlist")
            is Bip39Mnemonic.Validation.BadChecksum ->
                throw IllegalArgumentException("The mnemonic failed the BIP39 checksum — check the word order")
        }
    }

    /**
     * Loads and decrypts the wallet seed. For a biometric-protected wallet the caller must
     * first run [BiometricPromptHelper.authenticate] so the Keystore key is unlocked.
     *
     * @throws Exception (e.g. [android.security.keystore.UserNotAuthenticatedException],
     *   [android.security.keystore.KeyPermanentlyInvalidatedException]) when the seed
     *   cannot be unlocked — callers must surface the reason honestly.
     */
    fun loadSeed(context: Context): ByteArray {
        val encrypted = prefs(context).getString(KEY_ENCRYPTED_SEED, null)
            ?: throw IllegalStateException("No wallet exists on this device")
        return AndroidKeyStoreWrapper.decrypt(AndroidKeyStoreWrapper.SEED_ALIAS, encrypted)
    }

    /** True when the stored wallet uses a biometric-bound seed key. */
    fun isBiometricProtected(context: Context): Boolean =
        SecurePrefs(context).getBoolean(SecurePrefs.KEY_BIOMETRIC_ENABLED, false)

    /**
     * Switches the seed key protection between plain and biometric-bound.
     * Re-encrypts the existing seed under a fresh key with the target protection.
     */
    fun setBiometricProtection(context: Context, enabled: Boolean) {
        val seed = loadSeed(context) // decrypts under the CURRENT key (may require auth)
        AndroidKeyStoreWrapper.deleteKey(AndroidKeyStoreWrapper.SEED_ALIAS)
        val encrypted = AndroidKeyStoreWrapper.encrypt(
            alias = AndroidKeyStoreWrapper.SEED_ALIAS,
            plaintext = seed,
            biometricProtected = enabled
        )
        prefs(context).edit().putString(KEY_ENCRYPTED_SEED, encrypted).apply()
        SecurePrefs(context).putBoolean(SecurePrefs.KEY_BIOMETRIC_ENABLED, enabled)
    }

    /** Removes the wallet and its key material from this device. */
    fun deleteWallet(context: Context) {
        AndroidKeyStoreWrapper.deleteKey(AndroidKeyStoreWrapper.SEED_ALIAS)
        prefs(context).edit().clear().apply()
        val securePrefs = SecurePrefs(context)
        securePrefs.remove(SecurePrefs.KEY_WALLET_CREATED)
        securePrefs.remove(SecurePrefs.KEY_BIOMETRIC_ENABLED)
    }
}
