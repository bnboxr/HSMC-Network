package com.hsmc.wallet

import android.app.Application

/**
 * HSMC Wallet application entry point.
 *
 * Phase 1 performs no global initialization: wallet services ([com.hsmc.wallet.core.*])
 * are instantiated lazily per screen and the Android Keystore is touched only on demand.
 */
class HsmcApplication : Application()
