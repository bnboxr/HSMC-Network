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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.network.AddressTxsResult
import com.hsmc.wallet.network.NodeClient
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Transaction history (Phase 3, step 1 — real on-chain listing).
 *
 * The screen asks the node (through the API server's /node-proxy bridge) for the
 * wallet address's transactions (GET /address/{address}/txs). ONLY entries the node
 * actually returns are listed; an unreachable node or a missing endpoint shows an
 * explicit honest reason — never fabricated rows.
 */
@Composable
fun TransactionHistoryScreen(
    onBack: () -> Unit,
    onTxClick: (String) -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val nodeClient = remember { NodeClient.create(context) }
    val address = remember { WalletStorage.address(context) }

    var loading by remember { mutableStateOf(true) }
    var result by remember { mutableStateOf<AddressTxsResult?>(null) }

    LaunchedEffect(address) {
        loading = true
        val addr = address
        result = if (addr != null) {
            nodeClient.fetchAddressTransactions(addr)
        } else {
            AddressTxsResult(
                available = false, total = null, transactions = emptyList(),
                reason = "No wallet address on this device",
            )
        }
        loading = false
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
            title = "Transaction history",
            subtitle = "On-chain activity of this wallet.",
            onBack = onBack
        )
        when {
            loading -> HsmcCard {
                Text("Loading…", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = "Querying the HSMC node for this address's transactions.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            result?.available == true -> {
                val r = result!!
                if (r.transactions.isEmpty()) {
                    HsmcCard {
                        Text("No transactions yet", style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = "The node reports no transactions for this address " +
                                "(${address ?: "unknown"}). Only entries the node returns " +
                                "are shown — nothing is fabricated.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    HsmcCard {
                        Text(
                            text = "${r.transactions.size} transaction${if (r.transactions.size == 1) "" else "s"} (node-reported)",
                            style = MaterialTheme.typography.titleMedium
                        )
                    }
                    r.transactions.forEach { entry ->
                        HsmcCard(modifier = Modifier.clickable { onTxClick(entry.txHash) }) {
                            Text(
                                text = entry.txHash,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(Modifier.height(4.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text(
                                    text = if (entry.confirmed) "Confirmed" else "In mempool",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (entry.confirmed) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    }
                                )
                                if (entry.blockNumber != null) {
                                    Text(
                                        text = "Block ${entry.blockNumber}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                    PhaseNote("Tap a transaction to query its live status from the node.")
                }
            }
            else -> HsmcCard {
                Text(
                    text = "History unavailable",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.error
                )
                Text(
                    text = result?.reason ?: "Unknown error.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "No transaction list is fabricated. This screen only shows " +
                        "entries the node actually returns.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
