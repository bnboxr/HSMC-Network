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
 * Staking (Phase 1 honest scaffold).
 *
 * Staking is not active in Phase 1: there is no chain connection and nothing is staked.
 * The planned reward tiers from the business plan are presented as plans, not promises,
 * and no staking balance/APY is fabricated.
 */
@Composable
fun StakingScreen(onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        ScreenHeader(
            title = "Staking",
            subtitle = "Earn rewards by staking HSMC.",
            onBack = onBack
        )

        HsmcCard {
            Text(
                text = "0 HSMC staked — staking is not live yet",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = "Staking activates with the mainnet node connection (Phase 2). The " +
                    "business plan targets Genesis 12.5% APR / Beta 18% APR reward tiers — " +
                    "these are plans, not earned rewards, and no stake is tracked here.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        PhaseNote(
            "Phase 2: stake/unstake transactions, reward accrual and lock-period management " +
                "against the live chain."
        )
    }
}
