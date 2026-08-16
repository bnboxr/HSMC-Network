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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.network.BalanceResult
import com.hsmc.wallet.network.NodeClient
import com.hsmc.wallet.network.NodeHealth
import com.hsmc.wallet.network.formatHsmcAmount
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.SecureScreen
import com.hsmc.wallet.ui.components.StatusRow
import kotlinx.coroutines.launch

/**
 * Wallet dashboard (Phase 3, step 1 — real node connectivity, honest balance).
 *
 * The wallet label and derived address come from [WalletStorage]. The balance is fetched
 * from the HSMC node through the API server's /node-proxy bridge: when the node is
 * online and answers, the REAL on-chain balance is shown; when the node is offline or
 * the endpoint is not (yet) exposed by the bridge, the screen says so explicitly and
 * NEVER prints a fabricated "0.00000000".
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
    val nodeClient = remember { NodeClient.create(context) }
    val scope = rememberCoroutineScope()
    val walletCreated = remember { WalletStorage.walletExists(context) }
    val label = remember { WalletStorage.label(context) }
    val address = remember { WalletStorage.address(context) }
    val wordCount = remember { WalletStorage.wordCount(context) }

    var health by remember { mutableStateOf<NodeHealth?>(null) }
    var balance by remember { mutableStateOf<BalanceResult?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    suspend fun refresh() {
        refreshing = true
        val h = nodeClient.checkHealth()
        health = h
        val addr = address
        balance = if (h.nodeOnline && addr != null) {
            nodeClient.fetchBalance(addr)
        } else {
            BalanceResult(available = false, balanceHsmc = null, utxoCount = null, reason = null)
        }
        refreshing = false
    }

    LaunchedEffect(address) { refresh() }

    // N8 (security review): the derived HSMC address is displayed here (and on Login);
    // for a privacy coin that address must not be screenshotable, screen-recordable or
    // visible in the app-switcher preview, so the whole screen runs under FLAG_SECURE —
    // the same treatment Receive/Create/Confirm already have. The address stays fully
    // visible on screen; only capture is blocked.
    SecureScreen {
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
            BalanceLine(balance = balance, health = health, refreshing = refreshing)
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
            when {
                refreshing -> StatusRow(
                    label = "Node",
                    status = "checking…",
                    dotColor = Color(0xFFFFB300)
                )
                health?.nodeOnline == true -> StatusRow(
                    label = "Node",
                    status = "online",
                    dotColor = Color(0xFF2E7D32)
                )
                else -> StatusRow(
                    label = "Node",
                    status = health?.error ?: "not connected",
                    dotColor = Color(0xFFB71C1C)
                )
            }
            StatusRow(
                label = "Network",
                status = health?.nodeData?.network ?: "unavailable — node offline",
                dotColor = if (health?.nodeOnline == true) Color(0xFF2E7D32) else Color(0xFFB71C1C)
            )
            StatusRow(
                label = "Node version",
                status = health?.nodeData?.version ?: "unavailable — node offline",
                dotColor = if (health?.nodeOnline == true) Color(0xFF2E7D32) else Color(0xFFB71C1C)
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Latest block height and TPS are not exposed by /node-proxy yet " +
                    "(server contract gap) — no numbers are guessed.",
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
        HsmcSecondaryButton(
            text = if (refreshing) "Checking…" else "Refresh",
            enabled = !refreshing,
            onClick = { scope.launch { refresh() } }
        )
        HsmcSecondaryButton(text = "Settings", onClick = onSettings)
        PhaseNote(
            "Staking, mining, privacy proofs and hardware wallet still land in later " +
                "Phase 3 steps; only connectivity, balance, send submission and history " +
                "are wired here."
        )
        }
    }
}

/**
 * Honest balance line: real value when the node returned it, explicit "unavailable"
 * otherwise — never a fabricated zero.
 */
@Composable
private fun BalanceLine(
    balance: BalanceResult?,
    health: NodeHealth?,
    refreshing: Boolean
) {
    val balanceHsmc = balance?.balanceHsmc
    if (refreshing && balanceHsmc == null) {
        Text(
            text = "Balance: checking node…",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.primary
        )
        return
    }
    if (balanceHsmc != null && balance?.available == true) {
        Text(
            text = "Balance: ${formatHsmcAmount(balanceHsmc)} HSMC",
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.primary
        )
        Text(
            text = if (balance.utxoCount != null) {
                "On-chain UTXO balance (${balance.utxoCount} unspent output${if (balance.utxoCount == 1) "" else "s"}) — " +
                    "the node reports exactly this; nothing is estimated."
            } else {
                "On-chain balance as reported by the node."
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        return
    }
    // Honest unavailable state. Never claim a balance we did not receive.
    Text(
        text = "Balance: unavailable",
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
    val reason = when {
        health?.nodeOnline == false -> "node offline" + (health.error?.let { " — $it" } ?: "")
        balance?.reason != null -> balance.reason
        else -> "not connected to a node"
    }
    Text(
        text = "Balance unavailable ($reason). No balance is fabricated — nothing is " +
            "shown as real until the node answers.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
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
