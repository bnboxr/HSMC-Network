package com.hsmc.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.fragment.app.FragmentActivity
import com.hsmc.wallet.core.BiometricPromptHelper
import com.hsmc.wallet.core.Secrets.zeroize
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.StatusRow

/**
 * Biometric protection setup (Phase 2 — real, CryptoObject-bound).
 *
 *  - Reads the device's actual strong-biometric availability.
 *  - Requires the wallet password (the password factor unwraps the seed envelope).
 *  - Enabling creates a fresh Keystore key with
 *    `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)` (R2.1), re-encrypts
 *    the seed envelope under it, and binds the wrapping operation to a real
 *    BiometricPrompt CryptoObject. If the user cancels, the change is rolled back.
 *  - Disabling deletes the biometric-bound key and re-wraps the seed envelope under a
 *    plain Keystore key (also password-gated).
 *  - The enabled state is persisted in SecurePrefs; every error is reported honestly.
 */
@Composable
fun BiometricSetupScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val activity = LocalContext.current as FragmentActivity

    val biometricAvailable = remember { BiometricPromptHelper.canAuthenticate(context) }
    val walletExists = remember { WalletStorage.walletExists(context) }
    var biometricEnabled by remember { mutableStateOf(WalletStorage.isBiometricProtected(context)) }

    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    fun switchProtection(enable: Boolean) {
        if (busy) return
        if (password.isEmpty()) {
            message = "Enter your wallet password to ${if (enable) "enable" else "disable"} biometric protection."
            return
        }
        busy = true
        message = null
        val passwordChars = password.toCharArray()
        WalletStorage.setBiometricProtection(
            activity = activity,
            context = context,
            password = passwordChars,
            enable = enable
        ) { success, failure ->
            if (success) {
                biometricEnabled = WalletStorage.isBiometricProtected(context)
                message = if (enable) {
                    "Biometric protection enabled. Unlocking now requires your fingerprint or face " +
                        "(or the wallet password)."
                } else {
                    "Biometric protection disabled. The seed key no longer requires authentication."
                }
            } else {
                message = failure
            }
            password = ""
            passwordChars.zeroize()
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
            subtitle = "Bind your wallet seed key to this device's biometrics.",
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
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Wallet password") },
                    supportingText = { Text("Required to re-encrypt the seed envelope.") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    enabled = !busy,
                    visualTransformation = if (passwordVisible) VisualTransformation.None
                    else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    trailingIcon = {
                        Text(
                            text = if (passwordVisible) "Hide" else "Show",
                            modifier = Modifier.padding(8.dp),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                )

                if (biometricEnabled) {
                    HsmcPrimaryButton(
                        text = if (busy) "Working…" else "Disable biometric protection",
                        enabled = !busy,
                        onClick = { switchProtection(enable = false) }
                    )
                } else {
                    HsmcPrimaryButton(
                        text = if (busy) "Working…" else "Enable biometric protection",
                        enabled = !busy,
                        onClick = { switchProtection(enable = true) }
                    )
                    PhaseNote(
                        "Enabling shows a biometric prompt once so the new seed key can be " +
                            "bound to your fingerprint or face. Afterwards, every biometric " +
                            "unlock requires a fresh prompt — there is no timeout."
                    )
                }
            }
        }

        message?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodyMedium,
                color = if (message?.startsWith("Biometric protection enabled") == true ||
                    message?.startsWith("Biometric protection disabled") == true
                ) Color(0xFF2E7D32) else MaterialTheme.colorScheme.error
            )
        }

        PhaseNote(
            "Switching protection re-encrypts your existing seed under a new Android Keystore " +
                "key; the old key is deleted. The wallet password always remains a valid " +
                "unlock factor — biometrics add a second way to unlock, they do not replace " +
                "the password."
        )
    }
}
