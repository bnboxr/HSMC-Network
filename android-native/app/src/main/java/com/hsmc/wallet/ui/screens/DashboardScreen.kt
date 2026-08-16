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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.StatusRow
import androidx.compose.ui.graphics.Color

/**
 * Wallet dashboard (Phase 2 — real wallet identity, honest network state).
 *
 * The wallet label, derived address and locally recorded balance (0 until node sync)
 * come from [WalletStorage]. The balance row states plainly that no node is connected,
 * so "0" is not dressed up as a live on-chain balance. Block/TPS network cards are
 * honest "unavailable until node integration (Phase 3)" — no fabricated numbers.
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
    val label = remember { WalletStorage.label(context) }
    val address = remember { WalletStorage.address(context) }
    val wordCount = remember { WalletStorage.wordCount(context) }
    val balanceSats = remember { WalletStorage.balanceSats(context) }

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
                text = label ?: "HSMC wallet",
                style = MaterialTheme.typography.titleMedium
            )
            if (address != null) {
                Text(
                    text = address,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Balance: ${formatHsmc(balanceSats)} HSMC",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = "Not connected to a node — balance unavailable. This is the locally " +
                    "recorded balance (0 until the wallet is reconciled with the chain); " +
                    "no balance is fabricated. Node integration lands in Phase 3.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (wordCount > 0) {
                Text(
                    text = "${wordCount}-word BIP39 seed, encrypted on-device",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        HsmcCard {
            Text("Network", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            StatusRow(
                label = "Node",
                status = "not connected",
                dotColor = Color(0xFFFFB300)
            )
            StatusRow(
                label = "Latest block",
                status = "unavailable until node integration (Phase 3)",
                dotColor = Color(0xFFB71C1C)
            )
            StatusRow(
                label = "TPS",
                status = "unavailable until node integration (Phase 3)",
                dotColor = Color(0xFFB71C1C)
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
            "Send, history, staking, privacy and hardware wallet arrive with node " +
                "integration in Phase 3 and are not shown as active here."
        )
    }
}

/** 0.00000000-style formatting of satoshis (HSMC has 8 decimals). */
private fun formatHsmc(sats: Long): String {
    val negative = sats < 0
    val abs = if (negative) -sats else sats
    val whole = abs / 100_000_000L
    val frac = abs % 100_000_000L
    val fracStr = (100_000_000L + frac).toString().substring(1)
    return (if (negative) "-" else "") + "$whole.$fracStr"
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
