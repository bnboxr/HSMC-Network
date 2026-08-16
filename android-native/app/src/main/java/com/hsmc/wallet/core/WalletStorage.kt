package com.hsmc.wallet.core

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import com.hsmc.wallet.core.Secrets.zeroize
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.SecretKeyFactory

/**
 * Persists the wallet seed as ciphertext only (R1).
 *
 * Envelope encryption, all AES-256-GCM, only Base64(iv||ct||tag) ever touches disk:
 *
 *  ```
 *  seed  ──AES-GCM(DEK)──▶  seedBlob          (KEY_ENCRYPTED_SEED)
 *  DEK   ──AES-GCM(K_pw)──▶ kekPw             (KEY_KEK_PW)   ← password factor
 *  DEK   ──AES-GCM(K_ks)──▶ kekKs             (KEY_KEK_KS)   ← Android Keystore factor
 *  K_pw  = PBKDF2-HMAC-SHA512(password, salt, 600_000 iters)
 *  K_ks  = Android Keystore AES-256 key under [AndroidKeyStoreWrapper.SEED_ALIAS],
 *          created strong-biometric-bound when biometric protection is enabled (R2)
 *  ```
 *
 * - Password unlock decrypts [KEY_KEK_PW] and fails closed on a wrong password
 *   (GCM tag mismatch); it never needs the Keystore key.
 * - Biometric unlock decrypts [KEY_KEK_KS] through a BiometricPrompt CryptoObject
 *   (R2); the Keystore key is permanently invalidated if the user changes biometrics.
 * - The seed/DEK/password-derived key exist only as local [ByteArray]/[CharArray]
 *   variables and are zeroized in `finally` (R3). No secret is ever passed through
 *   navigation arguments (R3) or logged.
 */
object WalletStorage {

    private const val PREFS_FILE: String = "hsmc_wallet_vault"

    private const val KEY_ENCRYPTED_SEED: String = "encrypted_seed"
    private const val KEY_KEK_PW: String = "kek_pw"
    private const val KEY_KEK_KS: String = "kek_ks"
    private const val KEY_SALT: String = "salt"
    private const val KEY_KDF_ITERS: String = "kdf_iters"
    private const val KEY_WORD_COUNT: String = "word_count"
    private const val KEY_LABEL: String = "label"
    private const val KEY_ADDRESS: String = "address"
    private const val KEY_BALANCE_SATS: String = "balance_sats"

    /** OWASP-recommended PBKDF2 iteration count (the security report flags 100k as weak). */
    const val KDF_ITERATIONS: Int = 600_000

    private const val GCM_TRANSFORMATION: String = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS: Int = 128
    private const val IV_BYTES: Int = 12

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    /** True when a wallet exists in the current (Phase-2) vault format. */
    fun walletExists(context: Context): Boolean {
        val p = prefs(context)
        return p.contains(KEY_ENCRYPTED_SEED) && p.contains(KEY_KEK_PW)
    }

    /** Number of words the wallet was created with (for display only). */
    fun wordCount(context: Context): Int = prefs(context).getInt(KEY_WORD_COUNT, 0)

    /** Public wallet label chosen by the user at creation/import. */
    fun label(context: Context): String? = prefs(context).getString(KEY_LABEL, null)

    /** The derived on-chain HSMC address (public; shown on Dashboard/Receive). */
    fun address(context: Context): String? = prefs(context).getString(KEY_ADDRESS, null)

    /**
     * Locally recorded balance in satoshis. Phase 2 has no node connection, so this is
     * always 0 — the UI must say "not connected to node" and never dress it up as a
     * live balance. Node reconciliation lands in Phase 3.
     */
    fun balanceSats(context: Context): Long = prefs(context).getLong(KEY_BALANCE_SATS, 0L)

    // ── Crypto helpers ─────────────────────────────────────────────────────────

    private fun randomBytes(size: Int): ByteArray =
        ByteArray(size).also { SecureRandom().nextBytes(it) }

    private fun aesGcmEncrypt(key: SecretKey, plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(GCM_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ct = cipher.doFinal(plaintext)
        return cipher.iv + ct
    }

    private fun aesGcmEncrypt(key: ByteArray, plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(GCM_TRANSFORMATION)
        val spec = javax.crypto.spec.SecretKeySpec(key, "AES")
        cipher.init(Cipher.ENCRYPT_MODE, spec)
        val ct = cipher.doFinal(plaintext)
        return cipher.iv + ct
    }

    private fun aesGcmDecrypt(key: SecretKey, blob: ByteArray): ByteArray {
        require(blob.size > IV_BYTES) { "encrypted blob too small" }
        val iv = blob.copyOfRange(0, IV_BYTES)
        val ct = blob.copyOfRange(IV_BYTES, blob.size)
        val cipher = Cipher.getInstance(GCM_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(ct)
    }

    private fun aesGcmDecrypt(key: ByteArray, blob: ByteArray): ByteArray {
        require(blob.size > IV_BYTES) { "encrypted blob too small" }
        val iv = blob.copyOfRange(0, IV_BYTES)
        val ct = blob.copyOfRange(IV_BYTES, blob.size)
        val cipher = Cipher.getInstance(GCM_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, javax.crypto.spec.SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(ct)
    }

    private fun encode(blob: ByteArray): String = Base64.encodeToString(blob, Base64.NO_WRAP)
    private fun decode(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)

    /** Derives the 32-byte password key K_pw. Caller zeroizes the returned array. */
    private fun derivePasswordKey(password: CharArray, salt: ByteArray, iterations: Int): ByteArray {
        val spec = PBEKeySpec(password, salt, iterations, 256)
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA512").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }

    // ── Save ───────────────────────────────────────────────────────────────────

    /**
     * Validates [mnemonic] (real BIP39), derives the seed and the on-chain address,
     * and persists the encrypted envelope. The wallet starts with a plain (non-biometric)
     * Keystore key; biometric protection is enabled later from Settings.
     *
     * @return the number of words in the mnemonic, or throws [IllegalArgumentException]
     *   when the mnemonic/label/password are invalid.
     */
    fun saveWallet(
        context: Context,
        mnemonic: String,
        label: String,
        password: CharArray,
        biometricProtected: Boolean = false
    ): Int {
        require(label.isNotBlank()) { "Wallet label must not be empty" }
        require(password.size >= 8) { "Password must be at least 8 characters" }

        val words = Wordlist.load(context)
        val seed = Bip39Mnemonic.toSeed(mnemonic) // validated below; throws on bad mnemonic
        val dek = randomBytes(32)
        val salt = randomBytes(16)
        var passwordKey: ByteArray? = null
        try {
            val validation = Bip39Mnemonic.validate(mnemonic, words)
            if (validation !is Bip39Mnemonic.Validation.Valid) {
                throw IllegalArgumentException(
                    when (validation) {
                        is Bip39Mnemonic.Validation.WrongWordCount ->
                            "A BIP39 mnemonic has ${Bip39Mnemonic.VALID_WORD_COUNTS.joinToString("/")} words; got ${validation.actual}"
                        is Bip39Mnemonic.Validation.UnknownWord ->
                            "\"${validation.word}\" is not in the BIP39 English wordlist"
                        is Bip39Mnemonic.Validation.BadChecksum ->
                            "The mnemonic failed the BIP39 checksum — check the word order"
                        is Bip39Mnemonic.Validation.Valid -> error("unreachable")
                    }
                )
            }

            val address = HdKeys.deriveAddress(seed)
            passwordKey = derivePasswordKey(password, salt, KDF_ITERATIONS)

            val seedBlob = aesGcmEncrypt(dek, seed)
            val kekPw = aesGcmEncrypt(passwordKey, dek)
            // New wallets start unencumbered: ensure the (plain) Keystore key exists and wrap.
            if (!AndroidKeyStoreWrapper.keyExists(AndroidKeyStoreWrapper.SEED_ALIAS)) {
                AndroidKeyStoreWrapper.createKey(AndroidKeyStoreWrapper.SEED_ALIAS, biometricProtected)
            }
            val keystoreKey = AndroidKeyStoreWrapper.loadKey(AndroidKeyStoreWrapper.SEED_ALIAS)
            val kekKs = aesGcmEncrypt(keystoreKey, dek)

            prefs(context).edit()
                .putString(KEY_ENCRYPTED_SEED, encode(seedBlob))
                .putString(KEY_KEK_PW, encode(kekPw))
                .putString(KEY_KEK_KS, encode(kekKs))
                .putString(KEY_SALT, encode(salt))
                .putInt(KEY_KDF_ITERS, KDF_ITERATIONS)
                .putInt(KEY_WORD_COUNT, validation.wordCount)
                .putString(KEY_LABEL, label.trim())
                .putString(KEY_ADDRESS, address)
                .putLong(KEY_BALANCE_SATS, 0L)
                .apply()

            SecurePrefs(context).putBoolean(SecurePrefs.KEY_WALLET_CREATED, true)
            SecurePrefs(context).putBoolean(SecurePrefs.KEY_BIOMETRIC_ENABLED, biometricProtected)
            return validation.wordCount
        } finally {
            seed.zeroize()
            dek.zeroize()
            salt.zeroize()
            passwordKey?.zeroize()
        }
    }

    // ── Unlock ─────────────────────────────────────────────────────────────────

    /** Outcome of a password unlock attempt. */
    sealed interface PasswordUnlock {
        data object Success : PasswordUnlock
        data object WrongPassword : PasswordUnlock
        data class Failed(val message: String) : PasswordUnlock
    }

    /**
     * Verifies [password] by unwrapping the DEK and decrypting the seed, then zeroizes
     * everything. Wrong passwords fail closed (GCM tag mismatch on the password blob).
     */
    fun verifyPassword(context: Context, password: CharArray): PasswordUnlock {
        val p = prefs(context)
        val salt = decode(p.getString(KEY_SALT, null) ?: return PasswordUnlock.Failed("No wallet on this device"))
        val kekPw = decode(p.getString(KEY_KEK_PW, null) ?: return PasswordUnlock.Failed("No wallet on this device"))
        val seedBlob = decode(p.getString(KEY_ENCRYPTED_SEED, null) ?: return PasswordUnlock.Failed("No wallet on this device"))
        val iters = p.getInt(KEY_KDF_ITERS, KDF_ITERATIONS)
        var passwordKey: ByteArray? = null
        var dek: ByteArray? = null
        var seed: ByteArray? = null
        try {
            passwordKey = derivePasswordKey(password, salt, iters)
            dek = try {
                aesGcmDecrypt(passwordKey, kekPw)
            } catch (e: AEADBadTagException) {
                return PasswordUnlock.WrongPassword
            }
            seed = try {
                aesGcmDecrypt(dek, seedBlob)
            } catch (e: AEADBadTagException) {
                return PasswordUnlock.Failed("Stored wallet data failed its integrity check — restore from your seed phrase")
            }
            // Integrity is proven; the seed bytes are not needed by any Phase-2 flow.
            return PasswordUnlock.Success
        } catch (e: Exception) {
            return PasswordUnlock.Failed("Could not unlock the wallet: ${e.message}")
        } finally {
            passwordKey?.zeroize()
            dek?.zeroize()
            seed?.zeroize()
        }
    }

    /** Outcome of a biometric unlock attempt. */
    sealed interface BiometricUnlock {
        data object Success : BiometricUnlock
        data object Cancelled : BiometricUnlock
        data class Failed(val message: String) : BiometricUnlock
    }

    /**
     * Unlocks through the Android Keystore key ([KEY_KEK_KS]) with a BiometricPrompt
     * CryptoObject (R2). The seed is decrypted and zeroized internally — callers only
     * learn whether the wallet unlocked.
     */
    fun unlockWithBiometrics(
        activity: FragmentActivity,
        context: Context,
        title: String,
        subtitle: String,
        onResult: (BiometricUnlock) -> Unit
    ) {
        val p = prefs(context)
        val kekKsRaw = p.getString(KEY_KEK_KS, null)
        val seedBlobRaw = p.getString(KEY_ENCRYPTED_SEED, null)
        if (kekKsRaw == null || seedBlobRaw == null) {
            onResult(BiometricUnlock.Failed("No wallet on this device"))
            return
        }
        val kekKs = decode(kekKsRaw)
        val seedBlob = decode(seedBlobRaw)
        val iv = kekKs.copyOfRange(0, IV_BYTES)
        val ct = kekKs.copyOfRange(IV_BYTES, kekKs.size)

        val keystoreKey: SecretKey = try {
            AndroidKeyStoreWrapper.loadKey(AndroidKeyStoreWrapper.SEED_ALIAS)
        } catch (e: KeyPermanentlyInvalidatedException) {
            onResult(
                BiometricUnlock.Failed(
                    "Biometrics changed on this device, so the wallet's biometric key was invalidated. " +
                        "Unlock with your password and re-enable biometric protection in Settings."
                )
            )
            return
        } catch (e: Exception) {
            onResult(BiometricUnlock.Failed("The wallet key is unavailable: ${e.message}"))
            return
        }

        val cipher = Cipher.getInstance(GCM_TRANSFORMATION)
        val cryptoObject: BiometricPrompt.CryptoObject? = try {
            cipher.init(Cipher.DECRYPT_MODE, keystoreKey, GCMParameterSpec(GCM_TAG_BITS, iv))
            BiometricPrompt.CryptoObject(cipher)
        } catch (e: UserNotAuthenticatedException) {
            // Some API levels refuse the init without an auth token; fall back to a
            // plain prompt and re-init inside the authenticated callback.
            null
        }

        BiometricPromptHelper.authenticateWithCrypto(
            activity = activity,
            title = title,
            subtitle = subtitle,
            cryptoObject = cryptoObject
        ) { result ->
            var dek: ByteArray? = null
            try {
                when (result) {
                    is BiometricPromptHelper.Result.Success -> {
                        val authorizedCipher = result.cryptoObject?.cipher
                            ?: run {
                                val c2 = Cipher.getInstance(GCM_TRANSFORMATION)
                                c2.init(Cipher.DECRYPT_MODE, keystoreKey, GCMParameterSpec(GCM_TAG_BITS, iv))
                                c2
                            }
                        dek = authorizedCipher.doFinal(ct)
                        val seed = try {
                            aesGcmDecrypt(dek!!, seedBlob)
                        } catch (e: AEADBadTagException) {
                            onResult(
                                BiometricUnlock.Failed(
                                    "Stored wallet data failed its integrity check — restore from your seed phrase"
                                )
                            )
                            return@authenticateWithCrypto
                        }
                        seed.zeroize()
                        onResult(BiometricUnlock.Success)
                    }
                    is BiometricPromptHelper.Result.Cancelled -> onResult(BiometricUnlock.Cancelled)
                    is BiometricPromptHelper.Result.Failed ->
                        onResult(BiometricUnlock.Failed(result.message))
                }
            } catch (e: Exception) {
                onResult(BiometricUnlock.Failed("Could not unlock the wallet: ${e.message}"))
            } finally {
                dek?.zeroize()
            }
        }
    }

    // ── Biometric protection (R2 re-key) ───────────────────────────────────────

    /**
     * Re-keys the wallet between plain and strong-biometric-bound Keystore protection.
     *
     * The wallet password is required: it unwraps the DEK, which is then re-wrapped
     * under a fresh Keystore key with the requested protection. Enabling binds the new
     * key with `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)` and runs a
     * real BiometricPrompt with the encrypt CryptoObject (the bound key is only usable
     * with a fresh authentication). If the user cancels, the change is rolled back.
     *
     * @param onResult (success, human-readable message on failure)
     */
    fun setBiometricProtection(
        activity: FragmentActivity,
        context: Context,
        password: CharArray,
        enable: Boolean,
        onResult: (Boolean, String?) -> Unit
    ) {
        // 1. Unwrap the DEK with the password (no Keystore involved).
        val p = prefs(context)
        val saltRaw = p.getString(KEY_SALT, null)
        val kekPwRaw = p.getString(KEY_KEK_PW, null)
        val kekKsRaw = p.getString(KEY_KEK_KS, null)
        if (saltRaw == null || kekPwRaw == null || kekKsRaw == null) {
            onResult(false, "No wallet on this device")
            return
        }
        val salt = decode(saltRaw)
        val iters = p.getInt(KEY_KDF_ITERS, KDF_ITERATIONS)
        var passwordKey: ByteArray? = null
        var dek: ByteArray? = null
        try {
            passwordKey = derivePasswordKey(password, salt, iters)
            dek = try {
                aesGcmDecrypt(passwordKey, decode(kekPwRaw))
            } catch (e: AEADBadTagException) {
                onResult(false, "Wrong password — the wallet was not changed.")
                return
            }
            if (enable) {
                enableBiometricProtection(activity, context, dek!!, onResult)
            } else {
                disableBiometricProtection(context, dek!!, onResult)
            }
        } catch (e: Exception) {
            onResult(false, "Could not change biometric protection: ${e.message}")
        } finally {
            passwordKey?.zeroize()
            dek?.zeroize()
            salt.zeroize()
        }
    }

    private fun enableBiometricProtection(
        activity: FragmentActivity,
        context: Context,
        dek: ByteArray,
        onResult: (Boolean, String?) -> Unit
    ) {
        AndroidKeyStoreWrapper.deleteKey(AndroidKeyStoreWrapper.SEED_ALIAS)
        AndroidKeyStoreWrapper.createKey(AndroidKeyStoreWrapper.SEED_ALIAS, biometricProtected = true)
        val newKey = AndroidKeyStoreWrapper.loadKey(AndroidKeyStoreWrapper.SEED_ALIAS)

        val rollback = {
            AndroidKeyStoreWrapper.deleteKey(AndroidKeyStoreWrapper.SEED_ALIAS)
            AndroidKeyStoreWrapper.createKey(AndroidKeyStoreWrapper.SEED_ALIAS, biometricProtected = false)
            val plainKey = AndroidKeyStoreWrapper.loadKey(AndroidKeyStoreWrapper.SEED_ALIAS)
            prefs(context).edit()
                .putString(KEY_KEK_KS, encode(aesGcmEncrypt(plainKey, dek)))
                .apply()
            SecurePrefs(context).putBoolean(SecurePrefs.KEY_BIOMETRIC_ENABLED, false)
        }

        val cipher = Cipher.getInstance(GCM_TRANSFORMATION)
        val cryptoObject: BiometricPrompt.CryptoObject? = try {
            cipher.init(Cipher.ENCRYPT_MODE, newKey)
            BiometricPrompt.CryptoObject(cipher)
        } catch (e: UserNotAuthenticatedException) {
            null
        }

        BiometricPromptHelper.authenticateWithCrypto(
            activity = activity,
            title = "Enable biometric protection",
            subtitle = "Authenticate to bind your wallet seed key to this device's biometrics",
            cryptoObject = cryptoObject
        ) { result ->
            try {
                when (result) {
                    is BiometricPromptHelper.Result.Success -> {
                        val authorizedCipher = result.cryptoObject?.cipher
                            ?: run {
                                val c2 = Cipher.getInstance(GCM_TRANSFORMATION)
                                c2.init(Cipher.ENCRYPT_MODE, newKey)
                                c2
                            }
                        val kekKs = authorizedCipher.doFinal(dek)
                        prefs(context).edit().putString(KEY_KEK_KS, encode(kekKs)).apply()
                        SecurePrefs(context).putBoolean(SecurePrefs.KEY_BIOMETRIC_ENABLED, true)
                        onResult(true, null)
                    }
                    is BiometricPromptHelper.Result.Cancelled -> {
                        rollback()
                        onResult(false, "Authentication cancelled — biometric protection was not enabled.")
                    }
                    is BiometricPromptHelper.Result.Failed -> {
                        rollback()
                        onResult(false, "Authentication failed: ${result.message} — biometric protection was not enabled.")
                    }
                }
            } catch (e: Exception) {
                rollback()
                onResult(false, "Could not bind the seed key: ${e.message}")
            }
        }
    }

    private fun disableBiometricProtection(
        context: Context,
        dek: ByteArray,
        onResult: (Boolean, String?) -> Unit
    ) {
        try {
            AndroidKeyStoreWrapper.deleteKey(AndroidKeyStoreWrapper.SEED_ALIAS)
            AndroidKeyStoreWrapper.createKey(AndroidKeyStoreWrapper.SEED_ALIAS, biometricProtected = false)
            val plainKey = AndroidKeyStoreWrapper.loadKey(AndroidKeyStoreWrapper.SEED_ALIAS)
            prefs(context).edit().putString(KEY_KEK_KS, encode(aesGcmEncrypt(plainKey, dek))).apply()
            SecurePrefs(context).putBoolean(SecurePrefs.KEY_BIOMETRIC_ENABLED, false)
            onResult(true, null)
        } catch (e: Exception) {
            onResult(false, "Could not unbind the seed key: ${e.message}")
        }
    }

    /** True when the stored wallet uses a biometric-bound seed key. */
    fun isBiometricProtected(context: Context): Boolean =
        SecurePrefs(context).getBoolean(SecurePrefs.KEY_BIOMETRIC_ENABLED, false)

    /** Removes the wallet and its key material from this device. */
    fun deleteWallet(context: Context) {
        AndroidKeyStoreWrapper.deleteKey(AndroidKeyStoreWrapper.SEED_ALIAS)
        prefs(context).edit().clear().apply()
        val securePrefs = SecurePrefs(context)
        securePrefs.remove(SecurePrefs.KEY_WALLET_CREATED)
        securePrefs.remove(SecurePrefs.KEY_BIOMETRIC_ENABLED)
    }
}
