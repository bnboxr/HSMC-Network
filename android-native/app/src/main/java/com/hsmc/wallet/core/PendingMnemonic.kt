package com.hsmc.wallet.core

/**
 * In-memory holder for a freshly generated/imported mnemonic between screens
 * (Create -> Confirm -> Persist). Kept out of navigation arguments and never written
 * to disk; cleared as soon as the wallet is persisted.
 */
object PendingMnemonic {

    @Volatile
    private var value: String? = null

    fun set(mnemonic: String) {
        value = mnemonic
    }

    fun get(): String? = value

    fun clear() {
        value = null
    }

    val isSet: Boolean get() = value != null
}
