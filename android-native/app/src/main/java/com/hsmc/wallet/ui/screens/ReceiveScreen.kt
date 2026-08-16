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
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Receive HSMC (Phase 1 honest scaffold).
 *
 * An address is derived from the wallet keys using the node's address scheme (RingCT /
 * stealth). That derivation belongs to node integration, so Phase 1 shows no address at
 * all rather than a fabricated one.
 */
@Composable
fun ReceiveScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val hasWallet = remember { WalletStorage.walletExists(context) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        ScreenHeader(
            title = "Receive",
            subtitle = "Show an address to receive HSMC.",
            onBack = onBack
        )

        if (!hasWallet) {
            PhaseNote("No wallet on this device yet — create or import one first.")
            return@Column
        }

        HsmcCard {
            Text(
                text = "Address: unavailable",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = "Your address is derived from the wallet seed with the node's address " +
                    "scheme (stealth addresses, RingCT). Address derivation is part of node " +
                    "integration and lands in Phase 2 — showing a placeholder address here " +
                    "would risk displaying a useless or unsafe value.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        PhaseNote(
            "Phase 2: on-device address derivation, QR code display and copy-to-clipboard."
        )
    }
}
