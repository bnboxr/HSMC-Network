package com.hsmc.wallet.core

import android.util.Base64

/** Zeroization helpers for secret buffers (R3). */
object Secrets {
    fun ByteArray.zeroize() {
        fill(0)
    }

    fun CharArray.zeroize() {
        fill('\u0000')
    }
}
