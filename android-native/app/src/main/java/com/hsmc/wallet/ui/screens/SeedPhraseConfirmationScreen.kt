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
import androidx.compose.material3.OutlinedButton
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
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.SecureScreen

/** One quiz position: the user must pick the word that belongs at [index] (0-based). */
private data class QuizItem(val index: Int, val correctWord: String, val options: List<String>)

/**
 * Verifies that the user actually saved the freshly generated phrase (Phase 2).
 *
 * Three randomly chosen positions are quizzed with four choices each. The phrase is
 * read from the in-memory [PendingMnemonic] — never from navigation arguments (R3) —
 * and the wallet was already persisted encrypted on the Create screen. Answering all
 * three correctly finalizes the flow: the in-memory copy is cleared and the user is
 * taken to the dashboard.
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
                    // All quiz questions answered correctly — finalize.
                    HsmcCard {
                        Text(
                            text = "Backup verified. Your wallet is ready.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Text(
                            text = "Wallet: ${WalletStorage.label(context) ?: "unlabelled"} — " +
                                "the encrypted seed is stored on this device (Android Keystore, AES-256-GCM).",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    HsmcPrimaryButton(
                        text = "Open wallet",
                        onClick = {
                            // Finalize: the phrase has served its purpose; drop the
                            // in-memory copy (it never touches disk or nav args).
                            PendingMnemonic.clear()
                            onConfirmed()
                        }
                    )
                }
            }
        }
    }
}
