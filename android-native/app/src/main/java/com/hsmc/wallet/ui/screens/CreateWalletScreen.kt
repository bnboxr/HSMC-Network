package com.hsmc.wallet.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.hsmc.wallet.core.Bip39Mnemonic
import com.hsmc.wallet.core.PendingMnemonic
import com.hsmc.wallet.core.Secrets.zeroize
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.core.Wordlist
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.SecureScreen

/**
 * New wallet creation (Phase 2 — real flow).
 *
 * 1. The user picks 12/24 words and a wallet label.
 * 2. A real BIP39 mnemonic is generated with the device SecureRandom (R9).
 * 3. The user sets a password (≥8 chars, typed twice) — this encrypts the seed.
 * 4. On "I saved it — verify" the seed is derived, the address computed, and the
 *    wallet persisted encrypted via [WalletStorage] (R1). The phrase is handed to
 *    [SeedPhraseConfirmationScreen] through the in-memory [PendingMnemonic] only —
 *    never through navigation arguments (R3).
 *
 * No fake email registration, no fake auth token, nothing transmitted.
 */
@Composable
fun CreateWalletScreen(
    onBack: () -> Unit,
    onGenerated: () -> Unit
) {
    val context = LocalContext.current
    val words = remember { Wordlist.load(context) }

    var strengthBits by remember { mutableStateOf(256) } // 128 (12 words) or 256 (24 words)
    var mnemonic by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    var label by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }

    val labelOk = label.trim().isNotEmpty()
    val passwordOk = password.length >= 8
    val confirmOk = password.isNotEmpty() && password == confirm
    val credentialsOk = labelOk && passwordOk && confirmOk

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
                title = "Create a new wallet",
                subtitle = "A fresh seed phrase is generated on this device with the system " +
                    "SecureRandom. It never leaves this phone unencrypted.",
                onBack = onBack
            )

            OutlinedTextField(
                value = label,
                onValueChange = { label = it },
                label = { Text("Wallet label") },
                placeholder = { Text("e.g. My HSMC savings") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                enabled = mnemonic == null
            )

            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Unlock password") },
                supportingText = {
                    Text(
                        if (passwordOk) "OK — 8+ characters" else "At least 8 characters",
                        color = if (passwordOk) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                enabled = mnemonic == null,
                visualTransformation = if (passwordVisible) VisualTransformation.None
                else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                trailingIcon = {
                    Text(
                        text = if (passwordVisible) "Hide" else "Show",
                        modifier = Modifier
                            .clickable { passwordVisible = !passwordVisible }
                            .padding(8.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            )

            OutlinedTextField(
                value = confirm,
                onValueChange = { confirm = it },
                label = { Text("Confirm password") },
                supportingText = {
                    if (confirm.isNotEmpty() && !confirmOk) {
                        Text("Passwords do not match", color = MaterialTheme.colorScheme.error)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                enabled = mnemonic == null,
                visualTransformation = if (passwordVisible) VisualTransformation.None
                else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
            )

            if (mnemonic == null) {
                Text("Choose your security level:", style = MaterialTheme.typography.titleMedium)
                StrengthOption(
                    label = "12 words (128-bit entropy)",
                    selected = strengthBits == 128,
                    onClick = { strengthBits = 128 }
                )
                StrengthOption(
                    label = "24 words (256-bit entropy) — recommended for cold storage",
                    selected = strengthBits == 256,
                    onClick = { strengthBits = 256 }
                )

                HsmcPrimaryButton(
                    text = "Generate seed phrase",
                    enabled = credentialsOk,
                    onClick = {
                        error = null
                        mnemonic = try {
                            Bip39Mnemonic.generate(words, strengthBits)
                        } catch (e: Exception) {
                            error = "Generation failed: ${e.message}"
                            null
                        }
                    }
                )
                if (!credentialsOk) {
                    Text(
                        text = "Set a label and a matching password (8+ characters) to generate a wallet.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                val phrase = mnemonic ?: return@Column
                HsmcCard {
                    Text(
                        text = "Write these words down in order and store them offline. Anyone with " +
                            "this phrase controls the wallet. It will only be shown once.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error
                    )
                    Spacer(Modifier.height(12.dp))
                    WordGrid(phrase)
                }

                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    HsmcSecondaryButton(
                        text = "Regenerate",
                        onClick = { mnemonic = null },
                        modifier = Modifier.weight(1f)
                    )
                    HsmcPrimaryButton(
                        text = "I saved it — create wallet",
                        onClick = {
                            error = null
                            val passwordChars = password.toCharArray()
                            try {
                                // Real persistence: derive + encrypt + store under the
                                // Keystore-wrapped AES-GCM envelope (R1).
                                WalletStorage.saveWallet(
                                    context = context,
                                    mnemonic = phrase,
                                    label = label,
                                    password = passwordChars
                                )
                                PendingMnemonic.set(phrase)
                                onGenerated()
                            } catch (e: Exception) {
                                error = "Could not create the wallet: ${e.message}"
                            } finally {
                                passwordChars.zeroize()
                            }
                        },
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            error?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

/** Radio-style strength selector row. */
@Composable
private fun StrengthOption(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Text(text = label, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Numbered 3-column grid of the mnemonic words. */
@Composable
private fun WordGrid(mnemonic: String) {
    val normalized = Bip39Mnemonic.normalize(mnemonic)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        normalized.chunked(3).forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                row.forEach { word ->
                    Text(
                        text = word,
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }
    }
}
