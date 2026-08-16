package com.hsmc.wallet.core

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Thin, honest wrapper around androidx BiometricPrompt for strong biometric auth.
 *
 * Two entry points:
 *  - [authenticate] — plain prompt, no CryptoObject (device-availability checks,
 *    informational flows).
 *  - [authenticateWithCrypto] — prompt bound to a Keystore operation via
 *    [BiometricPrompt.CryptoObject] (R2). The caller prepares a [javax.crypto.Cipher]
 *    (DECRYPT or ENCRYPT mode) against the biometric-bound Keystore key; the system
 *    authenticates the user and the caller runs `doFinal` inside the success callback.
 *
 * Callers receive exactly one callback: success (with the authorized CryptoObject when
 * one was provided), cancel, or an error with a human-readable reason. Nothing is
 * claimed about authentication state beyond what the system reports.
 */
object BiometricPromptHelper {

    /** Sealed result delivered to callers. */
    sealed interface Result {
        /**
         * Biometric authentication succeeded. [cryptoObject] is non-null when the
         * prompt was created with one (callers must run `cipher.doFinal` with it).
         */
        data class Success(val cryptoObject: BiometricPrompt.CryptoObject?) : Result

        /** The user cancelled the prompt (or dismissed it). */
        data object Cancelled : Result

        /** The system reported an error. [code] is the BiometricPrompt error code. */
        data class Failed(val code: Int, val message: String) : Result
    }

    /** True when the device has strong biometrics and the user has enrolled one. */
    fun canAuthenticate(context: Context): Boolean {
        val result = BiometricManager.from(context)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        return result == BiometricManager.BIOMETRIC_SUCCESS
    }

    private fun callback(onResult: (Result) -> Unit) = object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            onResult(Result.Success(result.cryptoObject))
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            onResult(
                if (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    errorCode == BiometricPrompt.ERROR_CANCELED
                ) {
                    Result.Cancelled
                } else {
                    Result.Failed(errorCode, errString.toString())
                }
            )
        }

        // onAuthenticationFailed fires for a non-matching fingerprint while the prompt
        // stays open; we intentionally do NOT surface it as a terminal result.
    }

    private fun promptInfo(title: String, subtitle: String): BiometricPrompt.PromptInfo =
        BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText("Cancel")
            .build()

    /**
     * Shows the system biometric prompt without a CryptoObject.
     *
     * @param activity host; must be a FragmentActivity (MainActivity is one) because
     *   androidx.biometric requires it on API < 30.
     */
    fun authenticate(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        onResult: (Result) -> Unit
    ) {
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(activity, executor, callback(onResult))
        prompt.authenticate(promptInfo(title, subtitle))
    }

    /**
     * Shows the system biometric prompt bound to a Keystore operation.
     *
     * @param cryptoObject wraps a Cipher already initialized in ENCRYPT/DECRYPT mode
     *   against a biometric-bound Keystore key. Pass null to show a plain prompt
     *   (the caller then re-initializes the cipher inside the success callback).
     */
    fun authenticateWithCrypto(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        cryptoObject: BiometricPrompt.CryptoObject?,
        onResult: (Result) -> Unit
    ) {
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(activity, executor, callback(onResult))
        if (cryptoObject != null) {
            prompt.authenticate(promptInfo(title, subtitle), cryptoObject)
        } else {
            prompt.authenticate(promptInfo(title, subtitle))
        }
    }
}
