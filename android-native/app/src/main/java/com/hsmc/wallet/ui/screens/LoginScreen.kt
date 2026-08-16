package com.hsmc.wallet.ui.screens

import android.security.keystore.KeyPermanentlyInvalidatedException
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Wallet unlock screen.
 *
 * Honest behavior:
 *  - No wallet on device -> prompts to create/import.
 *  - Wallet protected by biometrics -> runs the real BiometricPrompt, then decrypts the
 *    seed with the Android Keystore. Errors (cancel, failed auth, invalidated key) are
 *    reported as-is; the screen never claims the wallet was unlocked when it was not.
 *  - Wallet without biometric protection -> states plainly that the wallet is unprotected
 *    and lets the user continue.
 */
@Composable
fun LoginScreen(
    onCreateWallet: () -> Unit,
    onImportWallet: () -> Unit,
    onUnlocked: () -> Unit
) {
    val context = LocalContext.current
    val activity = LocalContext.current as FragmentActivity
    val hasWallet = remember { WalletStorage.walletExists(context) }
    val biometricEnabled = remember { WalletStorage.isBiometricProtected(context) }

    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

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
            subtitle = "The seed is decrypted on-device with the Android Keystore."
        )

        when {
            !hasWallet -> {
                PhaseNote("No wallet found on this device.")
                HsmcPrimaryButton(text = "Create a new wallet", onClick = onCreateWallet)
                HsmcSecondaryButton(text = "Import an existing wallet", onClick = onImportWallet)
            }

            biometricEnabled -> {
                HsmcPrimaryButton(
                    text = if (busy) "Waiting for biometrics…" else "Unlock with biometrics",
                    enabled = !busy,
                    onClick = {
                        busy = true
                        message = null
                        BiometricPromptHelper.authenticate(
                            activity = activity,
                            title = "Unlock HSMC Wallet",
                            subtitle = "Authenticate to decrypt your wallet seed"
                        ) { result ->
                            when (result) {
                                is BiometricPromptHelper.Result.Success -> {
                                    try {
                                        // Forces the Keystore to actually unlock the seed;
                                        // throws if auth is not accepted.
                                        WalletStorage.loadSeed(context)
                                        onUnlocked()
                                    } catch (e: KeyPermanentlyInvalidatedException) {
                                        busy = false
                                        message = "Biometrics changed on this device, so the seed key " +
                                            "was invalidated. Open Settings → Biometric protection to " +
                                            "re-encrypt the wallet with the new biometrics."
                                    } catch (e: Exception) {
                                        busy = false
                                        message = "Could not unlock the wallet: ${e.message}"
                                    }
                                }

                                is BiometricPromptHelper.Result.Cancelled -> {
                                    busy = false
                                    message = "Authentication cancelled."
                                }

                                is BiometricPromptHelper.Result.Failed -> {
                                    busy = false
                                    message = "Authentication failed: ${result.message}"
                                }
                            }
                        }
                    }
                )
            }

            else -> {
                PhaseNote(
                    "This wallet has no unlock method configured. Until you enable biometrics " +
                        "in Settings, anyone with access to this device can open the wallet."
                )
                HsmcSecondaryButton(text = "Continue to wallet", onClick = onUnlocked)
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
