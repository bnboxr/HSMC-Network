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
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Hardware wallet support (Phase 1 honest scaffold).
 *
 * Not implemented. The "scan" action is intentionally disabled — a disabled scan button
 * is more honest than a scan that pretends to find devices.
 */
@Composable
fun HardwareWalletScreen(onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        ScreenHeader(
            title = "Hardware wallet",
            subtitle = "Pair a Ledger/Trezor device.",
            onBack = onBack
        )

        HsmcCard {
            Text(
                text = "Hardware wallet support is planned but not implemented in Phase 1.",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = "Phase 3 will add USB/BLE device discovery, seed validation and " +
                    "transaction signing on the device. Nothing is detected or connected in " +
                    "this build.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        HsmcPrimaryButton(
            text = "Scan for device",
            enabled = false,
            onClick = { /* intentionally disabled: no scanning logic in Phase 1 */ }
        )
    }
}
