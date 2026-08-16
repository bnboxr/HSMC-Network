package com.hsmc.wallet.ui.screens

import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.hsmc.wallet.core.BiometricPromptHelper
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.StatusRow

/**
 * Biometric protection setup (Phase 1).
 *
 * Real behavior — no alert theater:
 *  - Reads the device's actual biometric availability ([BiometricPromptHelper.canAuthenticate]).
 *  - Enabling runs the real BiometricPrompt first, then re-encrypts the wallet seed under a
 *    fresh, strong-biometric-bound Android Keystore key via [WalletStorage.setBiometricProtection].
 *  - Disabling runs the real BiometricPrompt too, because decrypting the currently
 *    biometric-bound seed requires a fresh authentication before re-encrypting under a plain key.
 *  - Every error (cancelled, failed, invalidated key) is reported as-is; the screen never
 *    claims protection was changed when it was not.
 *
 * Known Phase-2 follow-up: strict keystore timing ("auth token must be newer than key
 * creation") must be validated on-device for the enable path — see the QA parity report.
 */
@Composable
fun BiometricSetupScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val activity = LocalContext.current as FragmentActivity

    val biometricAvailable = remember { BiometricPromptHelper.canAuthenticate(context) }
    val walletExists = remember { WalletStorage.walletExists(context) }
    var biometricEnabled by remember { mutableStateOf(WalletStorage.isBiometricProtected(context)) }

    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    fun switchProtection(enable: Boolean) {
        if (busy) return
        busy = true
        message = null
        BiometricPromptHelper.authenticate(
            activity = activity,
            title = if (enable) "Enable biometric protection" else "Disable biometric protection",
            subtitle = "Authenticate to ${if (enable) "bind your seed key to" else "unbind your seed key from"} this device's biometrics"
        ) { result ->
            when (result) {
                is BiometricPromptHelper.Result.Success -> {
                    try {
                        WalletStorage.setBiometricProtection(context, enable)
                        biometricEnabled = WalletStorage.isBiometricProtected(context)
                        message = if (enable) {
                            "Biometric protection enabled. Unlocking the wallet now requires your fingerprint or face."
                        } else {
                            "Biometric protection disabled. The seed key no longer requires authentication."
                        }
                    } catch (e: KeyPermanentlyInvalidatedException) {
                        message = "Biometrics changed on this device, so the seed key was invalidated " +
                            "and the seed can no longer be decrypted. Restore it from your backup " +
                            "phrase with import (Phase 2)."
                    } catch (e: Exception) {
                        message = "Could not ${if (enable) "enable" else "disable"} biometric protection: ${e.message}"
                    }
                }

                is BiometricPromptHelper.Result.Cancelled -> {
                    message = "Authentication cancelled — nothing was changed."
                }

                is BiometricPromptHelper.Result.Failed -> {
                    message = "Authentication failed: ${result.message} — nothing was changed."
                }
            }
            busy = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        ScreenHeader(
            title = "Biometric protection",
            subtitle = "Bind your wallet seed to this device's biometrics.",
            onBack = onBack
        )

        HsmcCard {
            Text("Status", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            StatusRow(
                label = "Device biometrics",
                status = if (biometricAvailable) "available (strong)" else "not available or not enrolled",
                dotColor = if (biometricAvailable) Color(0xFF2E7D32) else Color(0xFFB71C1C)
            )
            StatusRow(
                label = "Wallet protection",
                status = if (biometricEnabled) "enabled" else "disabled",
                dotColor = if (biometricEnabled) Color(0xFF2E7D32) else Color(0xFFB71C1C)
            )
            StatusRow(
                label = "Seed storage",
                status = "AES-256-GCM, Android Keystore (no plaintext on disk)",
                dotColor = Color(0xFF2E7D32)
            )
        }

        when {
            !walletExists -> {
                PhaseNote(
                    "There is no wallet on this device yet. Create or import a wallet first, " +
                        "then come back here to protect it."
                )
            }

            !biometricAvailable -> {
                PhaseNote(
                    "This device has no strong biometrics enrolled (fingerprint or face). " +
                        "Biometric protection cannot be enabled. Add a biometric to the device " +
                        "and restart this screen."
                )
            }

            else -> {
                if (biometricEnabled) {
                    HsmcPrimaryButton(
                        text = if (busy) "Waiting for biometrics…" else "Disable biometric protection",
                        enabled = !busy,
                        onClick = { switchProtection(enable = false) }
                    )
                } else {
                    HsmcPrimaryButton(
                        text = if (busy) "Waiting for biometrics…" else "Enable biometric protection",
                        enabled = !busy,
                        onClick = { switchProtection(enable = true) }
                    )
                }
            }
        }

        message?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error
            )
        }

        PhaseNote(
            "Switching protection re-encrypts your existing seed under a new Android Keystore " +
                "key; the old key is deleted. When biometrics are enabled, every unlock and " +
                "every future seed operation requires a fresh biometric prompt — there is no " +
                "timeout."
        )
    }
}
