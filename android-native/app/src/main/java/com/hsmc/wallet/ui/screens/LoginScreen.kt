package com.hsmc.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.fragment.app.FragmentActivity
import com.hsmc.wallet.core.BiometricPromptHelper
import com.hsmc.wallet.core.Secrets.zeroize
import com.hsmc.wallet.core.SessionState
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.SecureScreen
import com.hsmc.wallet.ui.components.StatusRow
import androidx.compose.ui.graphics.Color

/**
 * Wallet unlock (Phase 2 — real flow).
 *
 * - Password unlock decrypts the seed through the password factor and FAILS CLOSED on
 *   a wrong password (GCM tag check). No fake tokens, no fake logins.
 * - Biometric unlock (shown when biometric protection is enabled) runs the real
 *   BiometricPrompt bound to the Keystore key via a CryptoObject (R2).
 * - Reset deletes the wallet and its key material after an explicit confirmation.
 * - With no wallet on the device, the screen routes to create/import.
 */
@Composable
fun LoginScreen(
    onCreateWallet: () -> Unit,
    onImportWallet: () -> Unit,
    onUnlocked: () -> Unit,
    onWalletReset: () -> Unit
) {
    val context = LocalContext.current
    val activity = LocalContext.current as FragmentActivity
    val hasWallet = remember { WalletStorage.walletExists(context) }
    val biometricEnabled = remember { WalletStorage.isBiometricProtected(context) }

    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmReset by remember { mutableStateOf(false) }

    // N8 (security review): the wallet's HSMC address is displayed at unlock. For a
    // privacy coin it must not be screenshotable, screen-recordable or visible in the
    // app-switcher preview, so the whole unlock screen runs under FLAG_SECURE — the same
    // treatment Receive/Create/Confirm/Dashboard already have. This does NOT break the
    // unlock UX: the address stays visible on screen, only capture is blocked; password
    // entry additionally benefits from not being screen-recordable. Decision documented
    // in PR android/phase3-step2-hygiene.
    SecureScreen {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
        ScreenHeader(
            title = "Unlock wallet",
            subtitle = "The seed is decrypted on-device; it is never transmitted."
        )

        when {
            !hasWallet -> {
                PhaseNote("No wallet found on this device.")
                HsmcPrimaryButton(text = "Create a new wallet", onClick = onCreateWallet)
                HsmcSecondaryButton(text = "Import an existing wallet", onClick = onImportWallet)
            }

            else -> {
                HsmcCard {
                    Text(
                        text = WalletStorage.label(context) ?: "HSMC wallet",
                        style = MaterialTheme.typography.titleMedium
                    )
                    WalletStorage.address(context)?.let { addr ->
                        Text(
                            text = addr,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    StatusRow(
                        label = "Unlock",
                        status = if (biometricEnabled) "password or biometrics" else "password",
                        dotColor = if (biometricEnabled) Color(0xFF2E7D32) else Color(0xFFFFB300)
                    )
                }

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
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

                HsmcPrimaryButton(
                    text = if (busy) "Unlocking…" else "Unlock with password",
                    enabled = password.isNotEmpty() && !busy,
                    onClick = {
                        busy = true
                        message = null
                        val passwordChars = password.toCharArray()
                        try {
                            when (val result = WalletStorage.verifyPassword(context, passwordChars)) {
                                is WalletStorage.PasswordUnlock.Success -> {
                                    SessionState.markUnlocked()
                                    password = ""
                                    onUnlocked()
                                }
                                is WalletStorage.PasswordUnlock.WrongPassword ->
                                    message = "Wrong password. The wallet stays locked."
                                is WalletStorage.PasswordUnlock.Failed -> message = result.message
                            }
                        } finally {
                            passwordChars.zeroize()
                            busy = false
                        }
                    }
                )

                if (biometricEnabled) {
                    HsmcSecondaryButton(
                        text = if (busy) "Waiting for biometrics…" else "Unlock with biometrics",
                        enabled = !busy,
                        onClick = {
                            busy = true
                            message = null
                            WalletStorage.unlockWithBiometrics(
                                activity = activity,
                                context = context,
                                title = "Unlock HSMC Wallet",
                                subtitle = "Authenticate to decrypt your wallet seed"
                            ) { result ->
                                when (result) {
                                    is WalletStorage.BiometricUnlock.Success -> {
                                        SessionState.markUnlocked()
                                        onUnlocked()
                                    }
                                    is WalletStorage.BiometricUnlock.Cancelled -> {
                                        message = "Authentication cancelled."
                                    }
                                    is WalletStorage.BiometricUnlock.Failed -> message = result.message
                                }
                                busy = false
                            }
                        }
                    )
                }

                HsmcSecondaryButton(
                    text = "Reset wallet on this device",
                    onClick = { confirmReset = true }
                )
            }
        }

        message?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error
            )
        }
        }
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Reset this wallet?") },
            text = {
                Text(
                    "This deletes the encrypted wallet, its key material and settings from " +
                        "this device. This cannot be undone — restore it later only with your " +
                        "seed phrase. Proceed?"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmReset = false
                    WalletStorage.deleteWallet(context)
                    SessionState.lock()
                    message = null
                    password = ""
                    onWalletReset()
                }) { Text("Delete wallet") }
            },
            dismissButton = {
                TextButton(onClick = { confirmReset = false }) { Text("Cancel") }
            }
        )
    }
}
