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
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Privacy center (Phase 1 honest scaffold).
 *
 * HSMC privacy (RingCT, CLSAG, stealth addresses) is enforced at the chain level. Phase 1
 * correctly reports that wallet-side privacy features are not yet integrated, and that no
 * private transaction has been sent from this device.
 */
@Composable
fun PrivacyScreen(onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        ScreenHeader(
            title = "Privacy",
            subtitle = "HSMC's privacy features and their status on this device.",
            onBack = onBack
        )

        HsmcCard {
            Text(
                text = "Chain-level privacy (RingCT / CLSAG / stealth addresses)",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = "HSMC transactions are private by default at the protocol level. " +
                    "Wallet-side integration of privacy key handling (stealth address " +
                    "scanning, view keys, ring-signature signing) is part of node " +
                    "integration and lands in Phase 3.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        HsmcCard {
            Text(
                text = "Status on this device",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = "No private (or any) transaction has been sent from this device. " +
                    "Your seed is encrypted at rest with the Android Keystore and never " +
                    "stored in plaintext.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        PhaseNote("Phase 3: stealth-address generation, view-key management and private-send flow.")
    }
}
