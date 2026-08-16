package com.hsmc.wallet

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.fragment.app.FragmentActivity
import com.hsmc.wallet.core.SecurePrefs
import com.hsmc.wallet.navigation.AppNavGraph
import com.hsmc.wallet.ui.theme.HsmcTheme

/**
 * Single-activity Compose app. FragmentActivity (not plain ComponentActivity) because
 * androidx.biometric's BiometricPrompt requires a FragmentActivity host on API < 30.
 */
class MainActivity : FragmentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            HsmcTheme(darkTheme = rememberThemeMode()) {
                AppNavGraph()
            }
        }
    }
}

/**
 * In-memory mirror of the persisted theme mode so Settings changes apply immediately
 * without recreating the activity. Persistence still happens in SecurePrefs; on cold
 * start [rememberThemeMode] falls back to the stored value.
 */
object ThemeModeState {
    var mode by mutableStateOf<String?>(null) // "system" | "light" | "dark" | null = not set
}

/**
 * Resolves the effective theme: in-memory override first, then the persisted preference,
 * then the system setting (null).
 */
@Composable
private fun rememberThemeMode(): Boolean? {
    val context = LocalContext.current
    val mode = ThemeModeState.mode
        ?: SecurePrefs(context).getString(SecurePrefs.KEY_THEME_MODE)
    return when (mode) {
        "light" -> false
        "dark" -> true
        else -> null // follow system
    }
}
