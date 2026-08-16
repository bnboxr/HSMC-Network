package com.hsmc.wallet.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.hsmc.wallet.core.QrCode
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcPrimaryButton
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.SecureScreen

/**
 * Receive HSMC (Phase 2 — real address).
 *
 * The address is the one derived from the persisted wallet seed at creation/import
 * (m/44'/8888'/0'/0/0, Ristretto255, "HSMC"+40 hex — the node's own derivation). The
 * QR is rendered with the real ZXing encoder, copy uses the real clipboard service,
 * and share fires a real share intent. No placeholder QR, no fake address.
 *
 * R7: the whole screen sets FLAG_SECURE (address + QR are sensitive).
 */
@Composable
fun ReceiveScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val hasWallet = remember { WalletStorage.walletExists(context) }
    val address = remember { WalletStorage.address(context) }

    var copied by remember { mutableStateOf(false) }
    var shareError by remember { mutableStateOf<String?>(null) }

    SecureScreen {
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

            if (!hasWallet || address == null) {
                PhaseNote("No wallet on this device yet — create or import one first.")
                return@Column
            }

            HsmcCard(horizontalAlignment = Alignment.CenterHorizontally) {
                val qr: Bitmap = remember(address) { QrCode.render(address, 480) }
                Image(
                    bitmap = qr.asImageBitmap(),
                    contentDescription = "QR code for the HSMC receive address",
                    modifier = Modifier
                        .size(220.dp)
                        .padding(8.dp)
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "HSMC address (first account, m/44'/8888'/0'/0/0)",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = address,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            HsmcPrimaryButton(
                text = if (copied) "Copied to clipboard" else "Copy address",
                onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("HSMC address", address))
                    copied = true
                }
            )

            HsmcSecondaryButton(
                text = "Share address",
                onClick = {
                    shareError = null
                    try {
                        val intent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, address)
                        }
                        context.startActivity(Intent.createChooser(intent, "Share HSMC address"))
                    } catch (e: Exception) {
                        shareError = "Could not open the share sheet: ${e.message}"
                    }
                }
            )

            shareError?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error
                )
            }

            PhaseNote(
                "The address is derived on-device from your wallet seed using the network's " +
                    "derivation (BIP44 m/44'/8888'/0'/0/0 over Ristretto255, Keccak-256). " +
                    "Balances and on-chain verification arrive with node integration in " +
                    "Phase 3."
            )
        }
    }
}
