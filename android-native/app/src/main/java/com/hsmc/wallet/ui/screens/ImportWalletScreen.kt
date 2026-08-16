package com.hsmc.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.core.Bip39Mnemonic
import com.hsmc.wallet.core.PendingMnemonic
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.core.Wordlist
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Import an existing wallet from a BIP39 seed phrase.
 *
 * The phrase is validated with the real BIP39 algorithm ([Bip39Mnemonic.validate]:
 * word count, wordlist membership, SHA-256 checksum) before anything is persisted.
 */
@Composable
fun ImportWalletScreen(
    onBack: () -> Unit,
    onImported: () -> Unit
) {
    val context = LocalContext.current
    val words = remember { Wordlist.load(context) }

    var input by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val normalized = Bip39Mnemonic.normalize(input)
    val validation = if (normalized.isEmpty()) null else Bip39Mnemonic.validate(normalized.joinToString(" "), words)
    val isValid = validation is Bip39Mnemonic.Validation.Valid

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        ScreenHeader(
            title = "Import wallet",
            subtitle = "Enter your 12, 15, 18, 21 or 24-word BIP39 seed phrase.",
            onBack = onBack
        )

        OutlinedTextField(
            value = input,
            onValueChange = { input = it },
            label = { Text("Seed phrase") },
            placeholder = { Text("word one word two …") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 4,
            maxLines = 8
        )

        when (val result = validation) {
            is Bip39Mnemonic.Validation.WrongWordCount ->
                Text(
                    text = "${result.actual} words entered — a BIP39 phrase has " +
                        Bip39Mnemonic.VALID_WORD_COUNTS.joinToString("/") + " words.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

            is Bip39Mnemonic.Validation.UnknownWord ->
                Text(
                    text = "\"${result.word}\" is not in the BIP39 English wordlist.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )

            is Bip39Mnemonic.Validation.BadChecksum ->
                Text(
                    text = "The phrase failed the BIP39 checksum — check the spelling and order of the words.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )

            is Bip39Mnemonic.Validation.Valid ->
                Text(
                    text = "Valid ${result.wordCount}-word BIP39 phrase.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )

            null -> Unit
        }

        error?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error
            )
        }

        HsmcPrimaryButton(
            text = if (busy) "Importing…" else "Import wallet",
            enabled = isValid && !busy,
            onClick = {
                busy = true
                error = null
                try {
                    WalletStorage.saveWallet(context, input)
                    PendingMnemonic.clear()
                    onImported()
                } catch (e: Exception) {
                    error = "Import failed: ${e.message}"
                    busy = false
                }
            }
        )

        PhaseNote(
            "The phrase is validated and the seed is derived and encrypted on this device " +
                "with the Android Keystore. Nothing is transmitted."
        )
    }
}
