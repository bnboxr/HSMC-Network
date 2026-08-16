package com.hsmc.wallet.core

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Real Android Keystore wrapper: AES-256-GCM keys under fixed aliases.
 *
 *  - [SEED_ALIAS]: the key protecting the BIP39 seed. Optionally created with strong
 *    biometric authentication binding (see [createKey]).
 *  - [PREFS_ALIAS]: a non-biometric key used to encrypt small preference values
 *    (see [SecurePrefs]). Never biometric-bound so that preferences remain readable
 *    without authentication.
 *
 * The seed is never stored in plaintext: only [encrypt] output (IV + ciphertext, base64)
 * is persisted, by [WalletStorage].
 *
 * API notes:
 *  - `setUserAuthenticationParameters` / `setUserAuthenticationRequired(boolean, boolean)`
 *    exist only on API 30+; on API 26-29 the one-arg `setUserAuthenticationRequired` is used.
 *  - If the biometric-bound key is invalidated by a new biometric enrollment,
 *    [decrypt] throws [KeyPermanentlyInvalidatedException] — callers surface this as an
 *    honest error and the user must re-encrypt the seed after re-enabling biometrics.
 */
object AndroidKeyStoreWrapper {

    const val KEYSTORE_PROVIDER: String = "AndroidKeyStore"
    const val KEY_ALGORITHM: String = KeyProperties.KEY_ALGORITHM_AES
    const val BLOCK_MODE: String = KeyProperties.BLOCK_MODE_GCM
    const val PADDING: String = KeyProperties.ENCRYPTION_PADDING_NONE
    const val KEY_SIZE_BITS: Int = 256

    /** Aliases are fixed; the seed key is recreated (delete + generate) when the
     *  biometric protection mode changes — the Keystore key spec is immutable. */
    const val SEED_ALIAS: String = "hsmc_seed_aes_key"
    const val PREFS_ALIAS: String = "hsmc_prefs_aes_key"

    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    }

    /** Whether a key with [alias] currently exists. */
    fun keyExists(alias: String): Boolean = keyStore.containsAlias(alias)

    /**
     * Creates a new AES-GCM key under [alias] if it does not exist yet.
     *
     * @param biometricProtected if true the key is only usable after a strong biometric
     *   authentication on the device; the key is permanently invalidated when the user
     *   adds/removes biometrics (API 30+ behavior, honored on all supported levels).
     */
    fun createKey(alias: String, biometricProtected: Boolean) {
        val specBuilder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(BLOCK_MODE)
            .setEncryptionPaddings(PADDING)
            .setKeySize(KEY_SIZE_BITS)
            .setRandomizedEncryptionRequired(true)

        if (biometricProtected) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                specBuilder.setUserAuthenticationParameters(
                    0, // auth always required (no timeout)
                    KeyProperties.AUTH_BIOMETRIC_STRONG
                )
            } else {
                @Suppress("DEPRECATION") // one-arg overload is the only option before API 30
                specBuilder.setUserAuthenticationRequired(true)
            }
        }

        val generator = KeyGenerator.getInstance(KEY_ALGORITHM, KEYSTORE_PROVIDER)
        generator.init(specBuilder.build())
        generator.generateKey()
    }

    /**
     * Loads the existing key under [alias]. Throws if the key does not exist
     * or is permanently invalidated.
     */
    fun loadKey(alias: String): SecretKey {
        if (!keyExists(alias)) {
            throw KeyMissingException(alias)
        }
        return keyStore.getKey(alias, null) as SecretKey
    }

    /**
     * Encrypts [plaintext] with AES-256-GCM under [alias]. The key is created on first use
     * with [biometricProtected] protection.
     *
     * @return base64 of IV (12 bytes) + ciphertext (includes the GCM authentication tag).
     */
    fun encrypt(alias: String, plaintext: ByteArray, biometricProtected: Boolean = false): String {
        if (!keyExists(alias)) {
            createKey(alias, biometricProtected)
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, loadKey(alias))
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(plaintext)
        return Base64.encodeToString(iv + ciphertext, Base64.NO_WRAP)
    }

    /**
     * Decrypts a value produced by [encrypt]. For biometric-bound keys this throws
     * [javax.crypto.AeadBadTagException] or [android.security.keystore.UserNotAuthenticatedException]
     * when the user has not authenticated; [KeyPermanentlyInvalidatedException] when the
     * key was invalidated by a biometric enrollment change.
     */
    fun decrypt(alias: String, encoded: String): ByteArray {
        val raw = Base64.decode(encoded, Base64.NO_WRAP)
        require(raw.size > 12) { "Encrypted blob too small: ${raw.size} bytes" }
        val iv = raw.copyOfRange(0, 12)
        val ciphertext = raw.copyOfRange(12, raw.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, loadKey(alias), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext)
    }

    /** Deletes the key under [alias] (used when switching biometric protection mode). */
    fun deleteKey(alias: String) {
        if (keyExists(alias)) {
            keyStore.deleteEntry(alias)
        }
    }
}

/** Thrown when a Keystore alias is referenced but does not exist. */
class KeyMissingException(alias: String) :
    IllegalStateException("Android Keystore key '$alias' does not exist")
