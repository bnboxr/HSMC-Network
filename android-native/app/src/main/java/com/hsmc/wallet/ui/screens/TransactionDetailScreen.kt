package com.hsmc.wallet.ui.screens

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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Transaction detail (Phase 1 honest scaffold).
 *
 * Accepts an optional tx id from navigation. Without a node connection there is no
 * on-chain data to fetch, so the screen explains that rather than showing a made-up
 * status/amount/timestamp.
 */
@Composable
fun TransactionDetailScreen(
    txId: String?,
    onBack: () -> Unit
) {
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

        HsmcCard {
            Text(
                text = "On-chain data not available yet",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = "Status, amount, fee and confirmations for this transaction come from " +
                    "the HSMC chain and require a node connection (Phase 3). No status — " +
                    "pending, confirmed or otherwise — is fabricated in this build.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
