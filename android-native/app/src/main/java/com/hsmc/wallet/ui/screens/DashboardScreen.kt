package com.hsmc.wallet.ui.screens

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
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.core.Wordlist
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Wallet dashboard (Phase 1 honest scaffold).
 *
 * The balance row deliberately shows "not connected" instead of a number: Phase 1 has no
 * node RPC client, so any balance would be fabricated. Balance, transactions and mining
 * arrive with node integration in Phase 2.
 */
@Composable
fun DashboardScreen(
    onSend: () -> Unit,
    onReceive: () -> Unit,
    onHistory: () -> Unit,
    onStaking: () -> Unit,
    onPrivacy: () -> Unit,
    onHardwareWallet: () -> Unit,
    onSettings: () -> Unit
) {
    val context = LocalContext.current
    val walletCreated = remember { WalletStorage.walletExists(context) }
    val wordCount = remember { WalletStorage.wordCount(context) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        ScreenHeader(title = "Dashboard", subtitle = "HSMC Wallet")

        HsmcCard {
            Text(
                text = if (walletCreated) {
                    "Wallet: created on this device (${if (wordCount > 0) "$wordCount-word BIP39 seed" else "seed"})"
                } else {
                    "No wallet on this device yet."
                },
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Balance: — HSMC (not connected to node)",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "Balances require a node connection, which lands in Phase 2. " +
                    "No balance is shown rather than a fake one.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Text("Features", style = MaterialTheme.typography.titleMedium)

        ActionGrid(
            items = listOf(
                "Send" to onSend,
                "Receive" to onReceive,
                "History" to onHistory,
                "Staking" to onStaking,
                "Privacy" to onPrivacy,
                "Hardware wallet" to onHardwareWallet
            )
        )

        HsmcSecondaryButton(text = "Settings", onClick = onSettings)

        PhaseNote(
            "Mining dashboard and HSMCPay merchant payments are planned for Phase 2 and are " +
                "not shown as active here."
        )
    }
}

/** Simple 2-column grid of feature entries. */
@Composable
private fun ActionGrid(items: List<Pair<String, () -> Unit>>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.chunked(2).forEach { rowItems ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rowItems.forEach { (label, onClick) ->
                    HsmcPrimaryButton(
                        text = label,
                        onClick = onClick,
                        modifier = Modifier.weight(1f)
                    )
                }
                if (rowItems.size == 1) {
                    // Keep alignment when the last row has a single item.
                    Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}
