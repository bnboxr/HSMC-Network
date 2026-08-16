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
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.core.Bip39Mnemonic
import com.hsmc.wallet.core.PendingMnemonic
import com.hsmc.wallet.core.Wordlist
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * New wallet creation. Generates a real BIP39 mnemonic (device SecureRandom) and shows it
 * to the user; the phrase stays in memory ([PendingMnemonic]) until it is verified on the
 * confirmation screen and persisted encrypted via the Android Keystore.
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
            subtitle = "A fresh seed phrase is generated on this device with the system SecureRandom. " +
                "It never leaves this phone unencrypted.",
            onBack = onBack
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

            error?.let {
                Text(text = it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
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
                    text = "I saved it — verify",
                    onClick = {
                        PendingMnemonic.set(phrase)
                        onGenerated()
                    },
                    modifier = Modifier.weight(1f)
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
