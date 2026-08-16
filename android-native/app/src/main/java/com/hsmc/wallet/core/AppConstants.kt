package com.hsmc.wallet.core

import com.hsmc.wallet.BuildConfig

/**
 * App-wide constants.
 *
 * API_BASE_URL is the HSMC team's live host (https://hsmc-network.ctonew.app — the
 * published project site/API), injected via BuildConfig so it can be overridden per
 * environment without touching code. It is deliberately NOT a fake placeholder domain.
 *
 * Phase 1 does not open any network sockets yet; this constant documents the origin that
 * Phase 2 (node RPC, HSMCPay, balances) will target.
 */
object AppConstants {
    val API_BASE_URL: String = BuildConfig.API_BASE_URL
}
