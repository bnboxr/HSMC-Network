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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Send HSMC (Phase 1 honest scaffold).
 *
 * Inputs are validated locally (address non-empty, amount a positive number), but the
 * broadcast button refuses to pretend anything happened: there is no node RPC client in
 * Phase 1, so no transaction hash is produced and no "sent/confirmed" state can exist.
 */
@Composable
fun SendScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val hasWallet = remember { WalletStorage.walletExists(context) }

    var address by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var attempt by remember { mutableStateOf(false) }

    val amountNumber = amount.toDoubleOrNull()
    val addressOk = address.isNotBlank()
    val amountOk = amountNumber != null && amountNumber > 0.0
    val valid = addressOk && amountOk

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        ScreenHeader(
            title = "Send",
            subtitle = "Transfer HSMC to another address.",
            onBack = onBack
        )

        if (!hasWallet) {
            PhaseNote("No wallet on this device yet — create or import one before sending.")
            return@Column
        }

        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            label = { Text("Recipient address") },
            placeholder = { Text("HSMC address (format validated in Phase 3)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        OutlinedTextField(
            value = amount,
            onValueChange = { amount = it.filter { c -> c.isDigit() || c == '.' } },
            label = { Text("Amount (HSMC)") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)
        )

        if (attempt) {
            when {
                !addressOk -> Text(
                    text = "Enter a recipient address.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
                !amountOk -> Text(
                    text = "Enter an amount greater than 0.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }

        HsmcPrimaryButton(
            text = "Review broadcast",
            enabled = valid,
            onClick = { attempt = true }
        )

        if (valid && attempt) {
            HsmcCard {
                Text(
                    text = "Nothing has been sent.",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "Phase 1 has no node RPC client, so this build cannot broadcast. " +
                        "Once node connectivity lands (Phase 3), the transaction will be " +
                        "constructed, signed on-device and broadcast to the network. " +
                        "No transaction hash is fabricated here.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
