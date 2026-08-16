package com.hsmc.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Transaction history (Phase 1 honest scaffold).
 *
 * No transactions can exist yet: nothing is sent in Phase 1 and there is no node RPC
 * client to query. The screen shows a truthful empty state instead of a fake list.
 */
@Composable
fun TransactionHistoryScreen(onBack: () -> Unit) {
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

        HsmcCard {
            Text(
                text = "No transactions yet",
                style = androidx.compose.material3.MaterialTheme.typography.titleMedium
            )
            Text(
                text = "History is loaded from the HSMC chain through a node connection. " +
                    "Phase 1 has no node RPC client, so there is nothing to show — and no " +
                    "fabricated transaction list will be displayed.",
                style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
                color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
