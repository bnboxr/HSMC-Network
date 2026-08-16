package com.hsmc.wallet.ui.components

import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Enables FLAG_SECURE for the hosting window (R7): the screen cannot be screenshotted,
 * screen-recorded, or appear in the app switcher preview.
 *
 * Wrap every screen that displays the seed phrase or an address/QR code. The flag is
 * removed automatically when the composable leaves composition.
 */
@Composable
fun SecureScreen(content: @Composable () -> Unit) {
    val view = LocalView.current
    val context = LocalContext.current
    DisposableEffect(Unit) {
        val window = (context as? android.app.Activity)?.window
            ?: return@DisposableEffect onDispose {}
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        // The window may be recreated (e.g. configuration change); keep the flag set.
        WindowCompat.setDecorFitsSystemWindows(window, true)
        onDispose {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
    content()
}
