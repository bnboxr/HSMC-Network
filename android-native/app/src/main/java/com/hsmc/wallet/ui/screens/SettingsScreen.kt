package com.hsmc.wallet.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.hsmc.wallet.BuildConfig
import com.hsmc.wallet.ThemeModeState
import com.hsmc.wallet.core.BiometricPromptHelper
import com.hsmc.wallet.core.SecurePrefs
import com.hsmc.wallet.core.SessionState
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.StatusRow

/**
 * Settings (Phase 2 — real persistence).
 *
 * Every preference is persisted in [SecurePrefs] (AES-256-GCM values under the Android
 * Keystore) and applied:
 *  - theme mode applies immediately;
 *  - the auto-lock timer is enforced by the app lifecycle (see [AppAutoLock]);
 *  - currency and node URL are persisted but only applied to displays/network in
 *    Phase 3 (stated honestly on the screen).
 *  - export seed stays explicitly disabled with honest copy (no fake reveal);
 *  - reset wallet deletes the wallet + key material after confirmation.
 */
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onBiometricSetup: () -> Unit,
    onLock: () -> Unit,
    onReset: () -> Unit
) {
    val context = LocalContext.current
    val prefs = remember { SecurePrefs(context) }

    var themeMode by remember { mutableStateOf(prefs.getString(SecurePrefs.KEY_THEME_MODE) ?: "system") }
    var currency by remember { mutableStateOf(prefs.getString(SecurePrefs.KEY_CURRENCY) ?: "USD") }
    var autoLockSeconds by remember { mutableStateOf(prefs.getInt(SecurePrefs.KEY_AUTO_LOCK_SECONDS, 300)) }
    var nodeUrl by remember { mutableStateOf(prefs.getString(SecurePrefs.KEY_NODE_URL) ?: "") }

    val biometricAvailable = remember { BiometricPromptHelper.canAuthenticate(context) }
    var biometricEnabled by remember { mutableStateOf(WalletStorage.isBiometricProtected(context)) }
    var notifGranted by remember {
        mutableStateOf(
            Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        )
    }
    var confirmReset by remember { mutableStateOf(false) }

    val notifPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> notifGranted = granted }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        ScreenHeader(
            title = "Settings",
            subtitle = "App preferences and security status.",
            onBack = onBack
        )

        HsmcCard {
            Text("Appearance", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            ThemeOption("System", themeMode == "system") {
                themeMode = "system"
                prefs.putString(SecurePrefs.KEY_THEME_MODE, "system")
                ThemeModeState.mode = "system"
            }
            ThemeOption("Light", themeMode == "light") {
                themeMode = "light"
                prefs.putString(SecurePrefs.KEY_THEME_MODE, "light")
                ThemeModeState.mode = "light"
            }
            ThemeOption("Dark", themeMode == "dark") {
                themeMode = "dark"
                prefs.putString(SecurePrefs.KEY_THEME_MODE, "dark")
                ThemeModeState.mode = "dark"
            }
        }

        HsmcCard {
            Text("Display currency", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            CurrencyOption("USD", currency == "USD") {
                currency = "USD"
                prefs.putString(SecurePrefs.KEY_CURRENCY, "USD")
            }
            CurrencyOption("EUR", currency == "EUR") {
                currency = "EUR"
                prefs.putString(SecurePrefs.KEY_CURRENCY, "EUR")
            }
            CurrencyOption("BTC", currency == "BTC") {
                currency = "BTC"
                prefs.putString(SecurePrefs.KEY_CURRENCY, "BTC")
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Stored preference. Price display is applied once node/oracle data " +
                    "arrives (Phase 3); nothing is fetched yet.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        HsmcCard {
            Text("Auto-lock", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            AutoLockOption("Never", autoLockSeconds == 0) {
                autoLockSeconds = 0
                prefs.putInt(SecurePrefs.KEY_AUTO_LOCK_SECONDS, 0)
            }
            AutoLockOption("After 1 minute", autoLockSeconds == 60) {
                autoLockSeconds = 60
                prefs.putInt(SecurePrefs.KEY_AUTO_LOCK_SECONDS, 60)
            }
            AutoLockOption("After 5 minutes", autoLockSeconds == 300) {
                autoLockSeconds = 300
                prefs.putInt(SecurePrefs.KEY_AUTO_LOCK_SECONDS, 300)
            }
            AutoLockOption("After 15 minutes", autoLockSeconds == 900) {
                autoLockSeconds = 900
                prefs.putInt(SecurePrefs.KEY_AUTO_LOCK_SECONDS, 900)
            }
            AutoLockOption("After 30 minutes", autoLockSeconds == 1800) {
                autoLockSeconds = 1800
                prefs.putInt(SecurePrefs.KEY_AUTO_LOCK_SECONDS, 1800)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Locks the app when it has been in the background longer than the " +
                    "selected time. Default 5 minutes.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        HsmcCard {
            Text("Node", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = nodeUrl,
                onValueChange = {
                    nodeUrl = it
                    prefs.putString(SecurePrefs.KEY_NODE_URL, it)
                },
                label = { Text("Node RPC URL") },
                placeholder = { Text("http://127.0.0.1:8080") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Persisted, but not yet applied — node connections arrive in Phase 3. " +
                    "The default node is 127.0.0.1:8080 (chain 8888).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        HsmcCard {
            Text("Security", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))

            StatusRow(
                label = "Biometric unlock",
                status = when {
                    !biometricAvailable -> "not available on this device"
                    biometricEnabled -> "enabled"
                    else -> "disabled"
                },
                dotColor = when {
                    !biometricAvailable -> Color(0xFFFFB300)
                    biometricEnabled -> Color(0xFF2E7D32)
                    else -> Color(0xFFB71C1C)
                }
            )
            StatusRow(
                label = "Seed storage",
                status = "AES-256-GCM, Android Keystore (no plaintext on disk)",
                dotColor = Color(0xFF2E7D32)
            )
            StatusRow(
                label = "App backup",
                status = "disabled (allowBackup=false)",
                dotColor = Color(0xFF2E7D32)
            )

            Spacer(Modifier.height(8.dp))
            HsmcSecondaryButton(
                text = if (biometricEnabled) "Biometric protection settings" else "Enable biometric protection",
                enabled = biometricAvailable && WalletStorage.walletExists(context),
                onClick = {
                    onBiometricSetup()
                    onBack()
                }
            )

            Spacer(Modifier.height(8.dp))
            HsmcSecondaryButton(
                text = "Lock wallet now",
                enabled = SessionState.unlocked,
                onClick = {
                    SessionState.lock()
                    onLock()
                }
            )
        }

        HsmcCard {
            Text("Seed phrase", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            HsmcSecondaryButton(
                text = "Export seed phrase — unavailable",
                enabled = false
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Seed export is intentionally disabled in this build. Revealing a seed " +
                    "needs a full security review (re-authentication, FLAG_SECURE, screen " +
                    "recording guard) before it ships; no fake reveal is offered.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        HsmcCard {
            Text("Danger zone", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            HsmcSecondaryButton(
                text = "Reset wallet on this device",
                onClick = { confirmReset = true }
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Deletes the encrypted wallet, key material and settings. Irreversible — " +
                    "restore only from your seed phrase.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        HsmcCard {
            Text("Notifications", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        if (Build.VERSION.SDK_INT >= 33 && !notifGranted) {
                            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                    },
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Allow notifications", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = if (Build.VERSION.SDK_INT >= 33) {
                            if (notifGranted) "Permission granted" else "Tap to request permission"
                        } else {
                            "Granted (pre-33)"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Switch(
                    checked = notifGranted,
                    onCheckedChange = { wantGranted ->
                        if (wantGranted && !notifGranted && Build.VERSION.SDK_INT >= 33) {
                            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            notifGranted = false
                        }
                    }
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Notifications are not implemented yet; this toggle only manages the " +
                    "Android runtime permission.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        HsmcCard {
            Text("About", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Version ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}${if (BuildConfig.DEBUG) " debug" else ""})",
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = "API: ${BuildConfig.API_BASE_URL}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        PhaseNote(
            "Preferences are stored encrypted on-device (Android Keystore, AES-256-GCM). " +
                "Nothing in this screen transmits data."
        )
    }

    if (confirmReset) {
        AlertDialog(
            onDismissRequest = { confirmReset = false },
            title = { Text("Reset this wallet?") },
            text = {
                Text(
                    "This deletes the encrypted wallet, its key material and settings from " +
                        "this device. This cannot be undone — restore it later only with your " +
                        "seed phrase. Proceed?"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmReset = false
                    WalletStorage.deleteWallet(context)
                    SessionState.lock()
                    onReset()
                }) { Text("Delete wallet") }
            },
            dismissButton = {
                TextButton(onClick = { confirmReset = false }) { Text("Cancel") }
            }
        )
    }
}

@Composable
private fun ThemeOption(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun CurrencyOption(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun AutoLockOption(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}
