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
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader

/**
 * Landing screen. Routes to create/import flows, or directly to unlock when a wallet
 * already exists on this device.
 */
@Composable
fun WelcomeScreen(
    onCreateWallet: () -> Unit,
    onImportWallet: () -> Unit,
    onExistingWallet: () -> Unit
) {
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
            title = "HSMC Wallet",
            subtitle = "Private Layer 1 wallet — native Android build"
        )

        HsmcCard {
            Text(
                text = "HSMC Network is a privacy-first Layer 1 (RingCT, stealth addresses, " +
                    "Monero-grade anonymity). This Phase 1 build creates and stores your keys " +
                    "entirely on this device — nothing is sent anywhere yet.",
                style = MaterialTheme.typography.bodyMedium
            )
        }

        HsmcPrimaryButton(text = "Create a new wallet", onClick = onCreateWallet)
        HsmcSecondaryButton(text = "Import an existing wallet", onClick = onImportWallet)

        if (hasWallet) {
            HsmcSecondaryButton(text = "Open wallet on this device", onClick = onExistingWallet)
        }

        PhaseNote(
            "Phase 1 scope: wallet creation, real BIP39 keys, Android Keystore encryption and " +
                "biometric unlock. Node sync, balances and transactions arrive in Phase 3 — " +
                "no balances or transaction statuses shown in this build are real yet."
        )
    }
}
