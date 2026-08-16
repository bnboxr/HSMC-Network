package com.hsmc.wallet.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.core.Wordlist
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader

/** One quiz position: the user must pick the word that belongs at [index] (0-based). */
private data class QuizItem(val index: Int, val correctWord: String, val options: List<String>)

/**
 * Verifies that the user actually saved the freshly generated phrase: three randomly chosen
 * positions are quizzed with four choices each. Only after all three are answered correctly
 * is the wallet persisted (seed derived with real BIP39, encrypted with the Android Keystore)
 * and the in-memory copy cleared.
 */
@Composable
fun SeedPhraseConfirmationScreen(
    onBack: () -> Unit,
    onConfirmed: () -> Unit
) {
    val context = LocalContext.current
    val words = remember { Wordlist.load(context) }
    val mnemonic = remember { PendingMnemonic.get() }

    var quizIndex by remember { mutableStateOf(0) }
    var wrongMessage by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    val quiz = remember(mnemonic) {
        if (mnemonic == null) emptyList()
        else {
            val normalized = Bip39Mnemonic.normalize(mnemonic)
            normalized.indices.shuffled().take(3).sorted().map { i ->
                val correct = normalized[i]
                val distractors = words.filter { it != correct }.shuffled().take(3)
                QuizItem(index = i, correctWord = correct, options = (distractors + correct).shuffled())
            }
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
            title = "Verify your backup",
            subtitle = "Pick the word that belongs at each position to prove you saved the phrase.",
            onBack = onBack
        )

        when {
            mnemonic == null || quiz.isEmpty() -> {
                PhaseNote(
                    "There is no pending seed phrase. Go back and generate or import a wallet first."
                )
                HsmcSecondaryButton(text = "Back", onClick = onBack)
            }

            quizIndex < quiz.size -> {
                val item = quiz[quizIndex]
                HsmcCard {
                    Text(
                        text = "Word ${item.index + 1}",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = "Which word was number ${item.index + 1} in your phrase?",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                item.options.forEach { option ->
                    OutlinedButton(
                        onClick = {
                            wrongMessage = null
                            if (option == item.correctWord) {
                                quizIndex += 1
                            } else {
                                wrongMessage =
                                    "That is not word ${item.index + 1}. Go back and check your saved backup."
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(option)
                    }
                }

                wrongMessage?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }

            else -> {
                // All quiz questions answered correctly.
                HsmcCard {
                    Text(
                        text = "Backup verified. Creating your encrypted wallet now.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                error?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error
                    )
                }

                HsmcPrimaryButton(
                    text = "Create wallet",
                    onClick = {
                        error = null
                        try {
                            WalletStorage.saveWallet(context, mnemonic, biometricProtected = false)
                            PendingMnemonic.clear()
                            onConfirmed()
                        } catch (e: Exception) {
                            error = "Could not create the wallet: ${e.message}"
                        }
                    }
                )
            }
        }
    }
}
