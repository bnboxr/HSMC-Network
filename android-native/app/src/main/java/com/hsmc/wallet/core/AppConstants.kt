package com.hsmc.wallet.core

import com.hsmc.wallet.BuildConfig

/**
 * App-wide constants.
 *
 * API_BASE_URL is the HSMC team's live host (https://hsmc-network.ctonew.app — the
 * published project site/API), injected via BuildConfig so it can be overridden per
 * environment without touching code. It is deliberately NOT a fake placeholder domain.
 *
 * Phase 3 (step 1) networking: the app reaches the HSMC Rust node EXCLUSIVELY through
 * the API server's /node-proxy bridge (the ONE sanctioned path — see
 * server/api-server.ts `handleNodeProxy` + `NODE_PROXY_WHITELIST`). The API server
 * wraps every forwarded call in the envelope { ok, node_online, data }. The node URL
 * setting ([SecurePrefs.KEY_NODE_URL]) records which node the user intends to reach and
 * is surfaced in honest status copy; it is never dialed directly by the app.
 */
object AppConstants {
    /** API server origin — the host that exposes /node-proxy. */
    val API_BASE_URL: String = BuildConfig.API_BASE_URL

    /** The API server's node-proxy bridge path (POST { path, method, data }). */
    const val NODE_PROXY_PATH: String = "/node-proxy"

    /**
     * Placeholder default node the wallet is configured against (chain 8888). The app
     * does not dial it directly; it is shown in status copy and settings so the user
     * knows which node the bridge should be talking to.
     */
    const val DEFAULT_NODE_URL: String = "http://127.0.0.1:8080"

    /**
     * Minimum fee the Rust node accepts for a transparent transaction
     * (rust-node/hsmc-core/src/transaction.rs `MIN_BASE_FEE` = 0.0001).
     * The send screen uses this exact value so the node never rejects on fee grounds.
     */
    const val TRANSPARENT_MIN_FEE: Double = 0.0001

    /**
     * Dust threshold for transparent transactions (rust-node/hsmc-core/src/validator.rs
     * `DUST_THRESHOLD_HSMC` = 0.000001). Mirrored here for honest local validation
     * identical to the node's.
     */
    const val TRANSPARENT_DUST_THRESHOLD: Double = 0.000001
}
