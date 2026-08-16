package com.hsmc.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.network.NodeClient
import com.hsmc.wallet.network.TxLookupResult
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Transaction detail (Phase 3, step 1 — real node lookup).
 *
 * When a transaction id is provided, the screen queries the node through the API
 * server's /node-proxy bridge (GET /tx/{hash} — whitelisted). Status (mempool /
 * confirmed + block number) is shown ONLY as reported by the node; anything else is
 * an explicit honest error. No status is ever fabricated.
 */
@Composable
fun TransactionDetailScreen(
    txId: String?,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val nodeClient = remember { NodeClient.create(context) }
    var loading by remember { mutableStateOf(txId != null) }
    var lookup by remember { mutableStateOf<TxLookupResult?>(null) }

    LaunchedEffect(txId) {
        val id = txId
        if (id.isNullOrBlank()) {
            loading = false
            lookup = null
            return@LaunchedEffect
        }
        loading = true
        lookup = nodeClient.getTransaction(id)
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
            title = "Transaction details",
            subtitle = if (txId.isNullOrBlank()) "No transaction selected." else "Transaction id: $txId",
            onBack = onBack
        )
        when {
            txId.isNullOrBlank() -> HsmcCard {
                Text("No transaction selected", style = MaterialTheme.typography.titleMedium)
            }
            loading -> HsmcCard {
                Text("Loading…", style = MaterialTheme.typography.titleMedium)
                Text(
                    text = "Querying the node for this transaction.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            lookup?.found == true -> {
                val l = lookup!!
                HsmcCard {
                    Text(
                        text = when (l.location) {
                            "confirmed" -> "Confirmed"
                            "mempool" -> "In mempool (pending)"
                            else -> "Status: ${l.location ?: "unknown"}"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Spacer(Modifier.height(4.dp))
                    if (l.location == "confirmed") {
                        l.blockNumber?.let {
                            Text(
                                text = "Block number: $it",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                    Text(
                        text = "Transaction id: $txId",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "Status and block number are exactly what the node " +
                            "reported; nothing is estimated.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            else -> HsmcCard {
                Text(
                    text = "On-chain data unavailable",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.error
                )
                Text(
                    text = lookup?.error ?: "Unknown error.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "No status — pending, confirmed or otherwise — is fabricated " +
                        "in this build.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
