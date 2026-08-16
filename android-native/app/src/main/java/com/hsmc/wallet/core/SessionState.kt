package com.hsmc.wallet.core

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * In-memory wallet session state (Phase 2).
 *
 * Only the unlock state is held here — never the seed, DEK or password. Screens read
 * the public wallet metadata (label, address) from [WalletStorage], and no Phase-2
 * flow needs the seed after unlock, so nothing secret outlives the unlock call itself
 * (R3).
 */
object SessionState {

    /** True after a successful password or biometric unlock. */
    var unlocked by mutableStateOf(false)
        private set

    /** Wall-clock ms of the last successful unlock (for the auto-lock timer). */
    var unlockedAtMs by mutableLongStateOf(0L)
        private set

    fun markUnlocked() {
        unlocked = true
        unlockedAtMs = System.currentTimeMillis()
    }

    fun lock() {
        unlocked = false
        unlockedAtMs = 0L
    }
}
