package com.hsmc.wallet.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.hsmc.wallet.core.SecurePrefs
import com.hsmc.wallet.core.SessionState
import com.hsmc.wallet.ui.screens.BiometricSetupScreen
import com.hsmc.wallet.ui.screens.CreateWalletScreen
import com.hsmc.wallet.ui.screens.DashboardScreen
import com.hsmc.wallet.ui.screens.HardwareWalletScreen
import com.hsmc.wallet.ui.screens.ImportWalletScreen
import com.hsmc.wallet.ui.screens.LoginScreen
import com.hsmc.wallet.ui.screens.PrivacyScreen
import com.hsmc.wallet.ui.screens.ReceiveScreen
import com.hsmc.wallet.ui.screens.SeedPhraseConfirmationScreen
import com.hsmc.wallet.ui.screens.SendScreen
import com.hsmc.wallet.ui.screens.SettingsScreen
import com.hsmc.wallet.ui.screens.StakingScreen
import com.hsmc.wallet.ui.screens.TransactionDetailScreen
import com.hsmc.wallet.ui.screens.TransactionHistoryScreen
import com.hsmc.wallet.ui.screens.WelcomeScreen

/** All 15 Phase-1 destinations (Phase 2 keeps the same set). */
object Routes {
    const val WELCOME = "welcome"
    const val LOGIN = "login"
    const val CREATE_WALLET = "create_wallet"
    const val IMPORT_WALLET = "import_wallet"
    const val SEED_CONFIRMATION = "seed_confirmation"
    const val BIOMETRIC_SETUP = "biometric_setup"
    const val DASHBOARD = "dashboard"
    const val SEND = "send"
    const val RECEIVE = "receive"
    const val TRANSACTION_HISTORY = "transaction_history"
    const val TRANSACTION_DETAIL = "transaction_detail"
    const val STAKING = "staking"
    const val PRIVACY = "privacy"
    const val HARDWARE_WALLET = "hardware_wallet"
    const val SETTINGS = "settings"

    /** transaction_detail accepts an optional tx id; without one it shows the empty state. */
    const val TRANSACTION_DETAIL_ARG_TX_ID = "txId"
    const val TRANSACTION_DETAIL_WITH_ARG = "$TRANSACTION_DETAIL?$TRANSACTION_DETAIL_ARG_TX_ID={$TRANSACTION_DETAIL_ARG_TX_ID}"

    fun transactionDetail(txId: String? = null): String =
        if (txId.isNullOrBlank()) TRANSACTION_DETAIL
        else "$TRANSACTION_DETAIL?$TRANSACTION_DETAIL_ARG_TX_ID=$txId"
}

/**
 * Root navigation graph wiring all 15 screens.
 *
 * The app starts on the Welcome screen; onboarding flows (create → confirm → dashboard,
 * import → dashboard) and unlock (login → dashboard) are the real Phase-2 wallet
 * lifecycle. Dashboard hosts the feature screens.
 *
 * Auto-lock (R14): while the activity is in the background longer than the persisted
 * auto-lock limit, the session is locked and the user is returned to the Login screen.
 */
@Composable
fun AppNavGraph() {
    val navController = rememberNavController()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    // Auto-lock: enforced on background→foreground transitions.
    DisposableEffect(lifecycleOwner) {
        var stoppedAtMs = 0L
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> stoppedAtMs = System.currentTimeMillis()
                Lifecycle.Event.ON_START -> {
                    if (SessionState.unlocked && stoppedAtMs > 0L) {
                        val limitSeconds = SecurePrefs(context)
                            .getInt(SecurePrefs.KEY_AUTO_LOCK_SECONDS, 300)
                        val elapsed = System.currentTimeMillis() - stoppedAtMs
                        if (limitSeconds > 0 && elapsed >= limitSeconds * 1000L) {
                            SessionState.lock()
                            // Only bounce if the user is inside the app (not on login/welcome).
                            val route = currentRoute
                            if (route != Routes.LOGIN && route != Routes.WELCOME) {
                                navController.navigate(Routes.LOGIN) {
                                    popUpTo(Routes.WELCOME) { inclusive = false }
                                    launchSingleTop = true
                                }
                            }
                        }
                    }
                    stoppedAtMs = 0L
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    NavHost(
        navController = navController,
        startDestination = Routes.WELCOME
    ) {
        composable(Routes.WELCOME) {
            WelcomeScreen(
                onCreateWallet = { navController.navigate(Routes.CREATE_WALLET) },
                onImportWallet = { navController.navigate(Routes.IMPORT_WALLET) },
                onExistingWallet = { navController.navigate(Routes.LOGIN) }
            )
        }
        composable(Routes.LOGIN) {
            LoginScreen(
                onCreateWallet = { navController.navigate(Routes.CREATE_WALLET) },
                onImportWallet = { navController.navigate(Routes.IMPORT_WALLET) },
                onUnlocked = { navController.navigate(Routes.DASHBOARD) },
                onWalletReset = {
                    navController.navigate(Routes.WELCOME) {
                        popUpTo(Routes.WELCOME) { inclusive = false }
                        launchSingleTop = true
                    }
                }
            )
        }
        composable(Routes.CREATE_WALLET) {
            CreateWalletScreen(
                onBack = { navController.popBackStack() },
                onGenerated = { navController.navigate(Routes.SEED_CONFIRMATION) }
            )
        }
        composable(Routes.IMPORT_WALLET) {
            ImportWalletScreen(
                onBack = { navController.popBackStack() },
                onImported = { navController.navigate(Routes.DASHBOARD) }
            )
        }
        composable(Routes.SEED_CONFIRMATION) {
            SeedPhraseConfirmationScreen(
                onBack = { navController.popBackStack() },
                onConfirmed = {
                    navController.navigate(Routes.DASHBOARD) {
                        popUpTo(Routes.WELCOME) { inclusive = false }
                    }
                }
            )
        }
        composable(Routes.BIOMETRIC_SETUP) {
            BiometricSetupScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.DASHBOARD) {
            DashboardScreen(
                onSend = { navController.navigate(Routes.SEND) },
                onReceive = { navController.navigate(Routes.RECEIVE) },
                onHistory = { navController.navigate(Routes.TRANSACTION_HISTORY) },
                onStaking = { navController.navigate(Routes.STAKING) },
                onPrivacy = { navController.navigate(Routes.PRIVACY) },
                onHardwareWallet = { navController.navigate(Routes.HARDWARE_WALLET) },
                onSettings = { navController.navigate(Routes.SETTINGS) }
            )
        }
        composable(Routes.SEND) {
            SendScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.RECEIVE) {
            ReceiveScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.TRANSACTION_HISTORY) {
            TransactionHistoryScreen(onBack = { navController.popBackStack() })
        }
        composable(
            route = Routes.TRANSACTION_DETAIL_WITH_ARG,
            arguments = listOf(
                navArgument(Routes.TRANSACTION_DETAIL_ARG_TX_ID) {
                    type = NavType.StringType
                    defaultValue = ""
                }
            )
        ) { backStackEntry ->
            TransactionDetailScreen(
                txId = backStackEntry.arguments?.getString(Routes.TRANSACTION_DETAIL_ARG_TX_ID),
                onBack = { navController.popBackStack() }
            )
        }
        composable(Routes.STAKING) {
            StakingScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.PRIVACY) {
            PrivacyScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.HARDWARE_WALLET) {
            HardwareWalletScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onBiometricSetup = { navController.navigate(Routes.BIOMETRIC_SETUP) },
                onLock = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(Routes.WELCOME) { inclusive = false }
                        launchSingleTop = true
                    }
                },
                onReset = {
                    navController.navigate(Routes.WELCOME) {
                        popUpTo(Routes.WELCOME) { inclusive = false }
                        launchSingleTop = true
                    }
                }
            )
        }
    }
}
