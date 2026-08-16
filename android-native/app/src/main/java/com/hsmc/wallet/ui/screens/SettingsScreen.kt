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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.hsmc.wallet.BuildConfig
import com.hsmc.wallet.ThemeModeState
import com.hsmc.wallet.core.BiometricPromptHelper
import com.hsmc.wallet.core.SecurePrefs
import com.hsmc.wallet.core.WalletStorage
import com.hsmc.wallet.ui.components.HsmcCard
import com.hsmc.wallet.ui.components.HsmcSecondaryButton
import com.hsmc.wallet.ui.components.PhaseNote
import com.hsmc.wallet.ui.components.ScreenHeader
import com.hsmc.wallet.ui.components.StatusRow
import androidx.compose.ui.graphics.Color

/**
 * Settings (Phase 1).
 *
 * Real functionality: theme selection (persisted, applies immediately), biometric
 * protection status/toggle (routes to [BiometricSetupScreen]), and the POST_NOTIFICATIONS
 * runtime permission (API 33+). Honest states: notifications are not implemented yet, so
 * granting the permission changes nothing functionally.
 */
@Composable
fun SettingsScreen(onBack: () -> Unit, onBiometricSetup: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember { SecurePrefs(context) }

    var themeMode by remember { mutableStateOf(prefs.getString(SecurePrefs.KEY_THEME_MODE) ?: "system") }
    val biometricAvailable = remember { BiometricPromptHelper.canAuthenticate(context) }
    var biometricEnabled by remember { mutableStateOf(WalletStorage.isBiometricProtected(context)) }
    var notifGranted by remember {
        mutableStateOf(
            Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        )
    }

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
                            notifGranted = false // revoking is a no-op at runtime; system dialog only grants
                        }
                    }
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Notifications are not implemented in Phase 1. This toggle only manages " +
                    "the Android runtime permission.",
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
            "Wallet deletion and phrase reveal are intentionally not present in Phase 1 — " +
                "destructive actions need review before shipping."
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
