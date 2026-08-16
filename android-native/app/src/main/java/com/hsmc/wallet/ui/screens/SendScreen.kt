package com.hsmc.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.core.AppConstants
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.network.NodeClient
import com.hsmc.wallet.network.SubmitTxPayload
import com.hsmc.wallet.network.TxLookupResult
import com.hsmc.wallet.network.TxSubmitResult
import com.hsmc.wallet.network.formatHsmcAmount
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import kotlinx.coroutines.launch

/**
 * Send HSMC (Phase 3, step 1 — real submission path).
 *
 * Local validation mirrors the Rust node's rules (address format + dust threshold +
 * self-transfer, see rust-node/hsmc-core/src/validator.rs). The "Review broadcast" step
 * builds a real [SubmitTxPayload] and submits it through the API server's /node-proxy
 * bridge (POST /tx/submit — the sanctioned path). The node's actual response is shown:
 * a real tx_hash when the node accepted the tx into its mempool, or the node's real
 * error string when it rejected it. A transaction hash is NEVER fabricated, and no
 * "confirmed" state is ever claimed — confirmation comes only from the node via
 * GET /tx/{hash}.
 */
@Composable
fun SendScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val nodeClient = remember { NodeClient.create(context) }
    val scope = rememberCoroutineScope()
    val hasWallet = remember { WalletStorage.walletExists(context) }
    val fromAddress = remember { WalletStorage.address(context) }
    var address by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var attempt by remember { mutableStateOf(false) }
    var submitting by remember { mutableStateOf(false) }
    var submitResult by remember { mutableStateOf<TxSubmitResult?>(null) }
    var txLookup by remember { mutableStateOf<TxLookupResult?>(null) }
    var checkingStatus by remember { mutableStateOf(false) }

    val amountNumber = amount.toDoubleOrNull()
    val recipient = address.trim()
    val addressOk = isValidHsmcAddress(recipient)
    val amountOk = amountNumber != null && amountNumber > 0.0 &&
        amountNumber >= AppConstants.TRANSPARENT_DUST_THRESHOLD
    val notSelf = fromAddress != null && recipient.isNotEmpty() && recipient != fromAddress
    val valid = addressOk && amountOk && notSelf

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
        if (!hasWallet || fromAddress == null) {
            PhaseNote("No wallet on this device yet — create or import one before sending.")
            return@Column
        }
        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            label = { Text("Recipient address") },
            placeholder = { Text("HSMC + 40 hex chars (e.g. HSMCa4f9…)") },
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
                !addressOk -> ErrorText("Recipient must be a valid HSMC address (HSMC + 40 hex characters).")
                fromAddress == address -> ErrorText("Self-transfers are rejected by the node.")
                !amountOk -> ErrorText("Enter an amount greater than ${formatHsmcAmount(AppConstants.TRANSPARENT_DUST_THRESHOLD)} HSMC (node dust threshold).")
            }
        }
        HsmcPrimaryButton(
            text = "Review broadcast",
            enabled = valid && !submitting,
            onClick = { attempt = true; submitResult = null; txLookup = null }
        )
        if (valid && attempt && submitResult == null) {
            HsmcCard {
                Text(
                    text = "Review transaction",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary
                )
                ReviewRow("From", fromAddress)
                ReviewRow("To", recipient)
                ReviewRow("Amount", "${formatHsmcAmount(amountNumber!!)} HSMC")
                ReviewRow("Network fee", "${formatHsmcAmount(AppConstants.TRANSPARENT_MIN_FEE)} HSMC (node minimum)")
                ReviewRow("Privacy", "transparent — amounts and addresses are public")
                Spacer(Modifier.padding(4.dp))
                Text(
                    text = "On submit the transaction is sent to the node via the API " +
                        "bridge. Nothing is signed or claimed locally; the node's response " +
                        "is shown verbatim.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.padding(4.dp))
                HsmcPrimaryButton(
                    text = if (submitting) "Submitting…" else "Submit to network",
                    enabled = !submitting,
                    onClick = {
                        submitting = true
                        val payload = SubmitTxPayload(
                            from = fromAddress!!,
                            to = recipient,
                            amount = amountNumber!!,
                            fee = AppConstants.TRANSPARENT_MIN_FEE,
                            privacyLevel = "transparent"
                        )
                        // submitTransaction mirrors node-tx.ts: it refuses to build a fake
                        // result when the node is unreachable, and never fabricates a hash.
                        scope.launch {
                            submitResult = nodeClient.submitTransaction(payload)
                            submitting = false
                        }
                    }
                )
            }
        }
        submitResult?.let { result ->
            SubmitOutcomeCard(
                result = result,
                checkingStatus = checkingStatus,
                txLookup = txLookup,
                onCheckStatus = {
                    val hash = result.txHash
                    if (hash != null) {
                        checkingStatus = true
                        scope.launch {
                            txLookup = nodeClient.getTransaction(hash)
                            checkingStatus = false
                        }
                    }
                },
                onReset = {
                    submitResult = null
                    txLookup = null
                    address = ""
                    amount = ""
                    attempt = false
                }
            )
        }
    }
}

/** Real result card — success shows the node's hash, failure shows the node's reason. */
@Composable
private fun SubmitOutcomeCard(
    result: TxSubmitResult,
    checkingStatus: Boolean,
    txLookup: TxLookupResult?,
    onCheckStatus: () -> Unit,
    onReset: () -> Unit
) {
    HsmcCard {
        val hash = result.txHash
        if (hash != null && result.status == "pending") {
            Text(
                text = "Submitted to mempool",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = "Transaction id: $hash",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "Status: pending — accepted by the node but not yet confirmed. " +
                    "Confirmation can only be claimed when the node reports it.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.padding(4.dp))
            when {
                checkingStatus -> Text(
                    text = "Checking status…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                txLookup != null -> {
                    val statusText = when {
                        txLookup.location == "confirmed" -> {
                            "Confirmed in block ${txLookup.blockNumber ?: "?"} (node-reported)"
                        }
                        txLookup.location == "mempool" -> "Still in the node's mempool (not yet confirmed)"
                        else -> "Status unavailable: ${txLookup.error ?: "unknown"}"
                    }
                    Text(
                        text = statusText,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Spacer(Modifier.padding(4.dp))
            HsmcSecondaryButton(
                text = "Check status",
                enabled = !checkingStatus,
                onClick = onCheckStatus
            )
        } else {
            Text(
                text = "Submission failed",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.error
            )
            Text(
                text = result.error ?: "Unknown submission error — nothing reached the chain.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "No transaction hash is shown because the node did not return one.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Spacer(Modifier.padding(4.dp))
        HsmcSecondaryButton(text = "Start a new transfer", onClick = onReset)
    }
}

@Composable
private fun ReviewRow(label: String, value: String) {
    Column(Modifier.padding(vertical = 2.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(text = value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun ErrorText(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error
    )
}

/**
 * Mirrors the Rust node's address validation
 * (rust-node/hsmc-core/src/validator.rs `is_valid_hsmc_address`):
 * "HSMC" prefix + 40 ASCII hex digits, total length 44.
 */
private fun isValidHsmcAddress(addr: String): Boolean {
    if (!addr.startsWith("HSMC") || addr.length != 44) return false
    return addr.drop(4).all { it in "0123456789abcdefABCDEF" }
}
