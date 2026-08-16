package com.hsmc.wallet.core

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Thin, honest wrapper around androidx BiometricPrompt for strong biometric auth.
 *
 * Callers receive exactly one callback: success, cancel, or an error with a human-readable
 * reason. Nothing is claimed about authentication state beyond what the system reports.
 */
object BiometricPromptHelper {

    /** Sealed result delivered to callers. */
    sealed interface Result {
        /** Biometric authentication succeeded. */
        data object Success : Result

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

    /**
     * Shows the system biometric prompt.
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
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onResult(Result.Success)
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
        )

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText("Cancel")
            .build()

        prompt.authenticate(promptInfo)
    }
}
