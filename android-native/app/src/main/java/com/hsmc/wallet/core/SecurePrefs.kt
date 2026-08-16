package com.hsmc.wallet.core

import android.content.Context
import android.content.SharedPreferences

/**
 * Small encrypted preference store for non-sensitive app settings.
 *
 * Every value is encrypted with AES-256-GCM using a dedicated Android Keystore key
 * ([AndroidKeyStoreWrapper.PREFS_ALIAS]) before it is written to SharedPreferences, so no
 * plaintext value ever reaches disk. Keys (preference names) are not sensitive.
 *
 * Design note: the task brief allowed `androidx.security:security-crypto`
 * (EncryptedSharedPreferences) for this purpose. That library is deprecated by Google
 * (announced 2024) and pinned to an alpha release, so we deliberately did NOT add it to the
 * version catalog. The recommended replacement — encrypting values with our own Android
 * Keystore AES-GCM key — is implemented here instead, reusing [AndroidKeyStoreWrapper].
 *
 * The wallet seed itself is NOT stored through this class: it lives as a base64
 * ciphertext blob in [WalletStorage] under the seed key.
 */
class SecurePrefs(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    private fun encrypt(value: String): String =
        AndroidKeyStoreWrapper.encrypt(AndroidKeyStoreWrapper.PREFS_ALIAS, value.toByteArray(Charsets.UTF_8))

    private fun decrypt(encoded: String): String =
        String(AndroidKeyStoreWrapper.decrypt(AndroidKeyStoreWrapper.PREFS_ALIAS, encoded), Charsets.UTF_8)

    fun putString(key: String, value: String) {
        prefs.edit().putString(key, encrypt(value)).apply()
    }

    fun getString(key: String): String? {
        val encrypted = prefs.getString(key, null) ?: return null
        return try {
            decrypt(encrypted)
        } catch (e: Exception) {
            // Key missing or invalidated: the value cannot be recovered. Report as absent
            // rather than crashing; callers that require the value re-establish it.
            null
        }
    }

    fun putBoolean(key: String, value: Boolean) = putString(key, value.toString())

    fun getBoolean(key: String, default: Boolean): Boolean =
        getString(key)?.toBoolean() ?: default

    fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    companion object {
        private const val PREFS_FILE: String = "hsmc_secure_prefs"

        const val KEY_WALLET_CREATED: String = "wallet_created"
        const val KEY_BIOMETRIC_ENABLED: String = "biometric_enabled"
        const val KEY_THEME_MODE: String = "theme_mode" // "system" | "light" | "dark"
    }
}
