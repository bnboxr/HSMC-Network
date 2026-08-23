package com.hsmc.wallet.network

import android.content.Context
import com.hsmc.wallet.BuildConfig
import com.hsmc.wallet.core.AppConstants
import com.hsmc.wallet.core.SecurePrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.math.BigDecimal
import java.net.HttpURLConnection
import java.net.URL

/**
 * Real node connectivity for the HSMC wallet (Phase 3, steps 1 & 3).
 *
 * This client talks to the HSMC Rust node EXCLUSIVELY through the API server's
 * /node-proxy bridge — the ONE sanctioned path (server/api-server.ts, `handleNodeProxy`
 * + `NODE_PROXY_WHITELIST`). Every call is a POST to `{apiBaseUrl}/node-proxy` with the
 * envelope `{ path, method, data }`, mirroring the web frontend's `node-tx.ts`.
 *
 * The bridge answers with the envelope `{ ok, node_online, data }` (HTTP 200) when the
 * forwarded node call succeeded, `{ ok:false, node_online:false, error, hint }` (HTTP 200)
 * when the Rust node is unreachable, or a plain `{ error }` (HTTP 401/400) when the
 * request is rejected. All of these are surfaced honestly here — nothing is ever
 * fabricated (no fake balances, hashes, confirmations or addresses).
 *
 * Current server contract (server/api-server.ts, PR #16 on main):
 *   whitelisted read-only wallet routes (all reachable through /node-proxy):
 *     GET /health, POST /tx/submit, POST /tx/broadcast,
 *     POST /crypto/stealth/generate, POST /crypto/commitment,
 *     POST /crypto/ring-sign, POST /crypto/range-proof,
 *     GET /tx/{hash} (1-128 alphanumeric chars),
 *     GET /utxo/{address} (balance), GET /address/{address}/txs (history).
 * /node-proxy itself is API-key protected in production (NODE_ENV != dev): every
 * non-public call must present a valid `x-api-key` header or the server answers
 * HTTP 401 { error: "Unauthorized" } (server/api-server.ts:3256-3260, checkApiKey :590).
 * The Android side provides that key two ways (see [resolveApiKey]) and, when the
 * server returns 401, reports the honest "Unauthorized — configure API key" state
 * instead of a misleading "node offline" — never a fabricated credential.
 *
 * Security posture: no secrets logged, no request logging of payloads/addresses, TLS to
 * the API server (cleartext to arbitrary hosts remains blocked in release — the debug-
 * only network security config allows http solely to local emulator hosts), and the
 * configured node URL is never dialed directly.
 */
class NodeClient private constructor(
    private val apiBaseUrl: String,
    val configuredNodeUrl: String,
    private val apiKey: String?,
) {
    /** True when the Rust node behind the API bridge reported node_online=true. */
    suspend fun isNodeOnline(): Boolean = checkHealth().nodeOnline

    /**
     * GET /health through the bridge. Returns the envelope fields plus the node's
     * health payload (status, version, chain_id, network) when the node is reachable.
     */
    suspend fun checkHealth(): NodeHealth = withContext(Dispatchers.IO) {
        val r = postProxy(PATH_HEALTH, "GET", null)
        parseHealthEnvelope(r?.body, r?.httpCode ?: 0)
    }

    /**
     * Balance query: GET /utxo/{address} through the bridge (the node's authoritative
     * UTXO-set endpoint, rust-node/hsmc-rpc/src/handlers.rs get_utxo_set — whitelisted
     * since PR #16). The real balance is shown when the node answers; offline, auth or
     * error states surface their real reason — never a fabricated 0.00000000.
     */
    suspend fun fetchBalance(address: String): BalanceResult = withContext(Dispatchers.IO) {
        val r = postProxy("/utxo/$address", "GET", null)
        parseBalanceResult(r?.body, r?.httpCode ?: 0)
    }

    /**
     * Submit a transaction: POST /tx/submit through the bridge. Mirrors the web
     * frontend's submitTransaction (src/utils/node-tx.ts): a real tx_hash is returned
     * only when the node accepted the tx into its mempool; every other outcome carries
     * the node's/server's real error string.
     */
    suspend fun submitTransaction(payload: SubmitTxPayload): TxSubmitResult =
        withContext(Dispatchers.IO) {
            val r = postProxy("/tx/submit", "POST", payload.toJson())
            parseSubmitResult(r?.body, r?.httpCode ?: 0)
        }

    /**
     * Look up a transaction: GET /tx/{hash} through the bridge (whitelisted). Returns
     * the real location (mempool/confirmed) + block number when the node knows the tx.
     */
    suspend fun getTransaction(hash: String): TxLookupResult = withContext(Dispatchers.IO) {
        val r = postProxy("/tx/$hash", "GET", null)
        parseTxLookupResult(r?.body, r?.httpCode ?: 0)
    }

    /**
     * Address transaction listing: GET /address/{address}/txs through the bridge (the
     * node's endpoint, rust-node/hsmc-rpc/src/handlers.rs get_address_txs — whitelisted
     * since PR #16). Only entries the node actually returns are ever shown; an offline,
     * auth or error state surfaces its real reason.
     */
    suspend fun fetchAddressTransactions(address: String): AddressTxsResult =
        withContext(Dispatchers.IO) {
            val r = postProxy("/address/$address/txs", "GET", null)
            parseAddressTxsResult(r?.body, r?.httpCode ?: 0)
        }

    // ────────────────────────────────────────────────────────────────────────────
    // Transport
    // ────────────────────────────────────────────────────────────────────────────

    /**
     * Sends the { path, method, data } envelope to the bridge.
     *
     * Attaches an `x-api-key` header when an operator API key is configured (from
     * SecurePrefs or BuildConfig — see [resolveApiKey]) — the production /node-proxy
     * requires it (server/api-server.ts checkApiKey). Returns a [BridgeResponse] with the
     * HTTP status and parsed body on ANY HTTP response (2xx/4xx), or null when the API
     * server itself is unreachable (DNS/TLS/connect failure — the node is unreachable by
     * definition then). Nothing is fabricated: a 401 is reported with its real status so
     * the parser can show the honest "Unauthorized — configure API key" reason.
     */
    private fun postProxy(path: String, method: String, data: JSONObject?): BridgeResponse? {
        val url = URL("${apiBaseUrl.trimEnd('/')}${AppConstants.NODE_PROXY_PATH}")
        var conn: HttpURLConnection? = null
        try {
            conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.doOutput = true
            buildProxyHeaders(apiKey).forEach { (name, value) -> conn.setRequestProperty(name, value) }
            val envelope = JSONObject()
            envelope.put("path", path)
            envelope.put("method", method)
            if (data != null) envelope.put("data", data)
            conn.outputStream.use { out ->
                out.write(envelope.toString().toByteArray(Charsets.UTF_8))
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return BridgeResponse(
                httpCode = code,
                body = if (body.isBlank()) null else JSONObject(body),
            )
        } catch (e: JSONException) {
            // Malformed JSON from the server: treat as server error, never fabricate.
            return BridgeResponse(0, JSONObject().put("error", "Malformed response from API server: ${e.message}"))
        } catch (e: IOException) {
            // API server unreachable (DNS/TLS/connection refused/timeout).
            return null
        } finally {
            conn?.disconnect()
        }
    }

    companion object {
        private const val CONNECT_TIMEOUT_MS: Int = 10_000
        private const val READ_TIMEOUT_MS: Int = 15_000
        private const val PATH_HEALTH: String = "/health"

        /**
         * Builds a NodeClient bound to the live API server, reading the persisted node
         * URL setting for honest status copy and the operator API key for production
         * /node-proxy access. The configured node is NEVER dialed directly — all traffic
         * goes through the sanctioned /node-proxy bridge.
         */
        fun create(context: Context): NodeClient {
            val prefs = SecurePrefs(context.applicationContext)
            val nodeUrl = prefs.getString(SecurePrefs.KEY_NODE_URL)
                ?.takeIf { it.isNotBlank() }
                ?: AppConstants.DEFAULT_NODE_URL
            return NodeClient(AppConstants.API_BASE_URL, nodeUrl, resolveApiKey(prefs))
        }

        /**
         * Resolves the x-api-key for production /node-proxy access. Priority order:
         *   1. the operator runtime key persisted in SecurePrefs (Settings entry);
         *   2. a key compiled into the APK via BuildConfig.HSMC_API_KEY
         *      (set from gradle.properties / CI secret — empty by default).
         * Returns null when neither is configured: no `x-api-key` header is then sent,
         * and a production server's 401 is surfaced honestly.
         */
        internal fun resolveApiKey(prefs: SecurePrefs): String? {
            val runtime = prefs.getString(SecurePrefs.KEY_API_KEY)?.takeIf { it.isNotBlank() }
            if (runtime != null) return runtime
            return BuildConfig.HSMC_API_KEY.takeIf { it.isNotBlank() }
        }
    }
}

/**
 * The raw bridge HTTP exchange: status code plus parsed JSON body.
 * `httpCode` is 0 when the transport itself failed (body is then an error stubbed by
 * the client, or null when the API server was unreachable).
 */
internal data class BridgeResponse(val httpCode: Int, val body: JSONObject?)

/**
 * Builds the headers for a /node-proxy POST. Pure so it is unit-testable without a
 * network: an `x-api-key` header is present exactly when a (non-blank) key is supplied.
 */
internal fun buildProxyHeaders(apiKey: String?): Map<String, String> {
    val headers = mutableMapOf(
        "Content-Type" to "application/json",
        "Accept" to "application/json",
    )
    if (!apiKey.isNullOrBlank()) {
        headers[X_API_KEY_HEADER] = apiKey
    }
    return headers
}

/** HTTP header the production /node-proxy auth expects (server/api-server.ts checkApiKey). */
internal const val X_API_KEY_HEADER: String = "x-api-key"

// ════════════════════════════════════════════════════════════════════════════════
// Result types (all honest: every field is either real node data or null + reason)
// ════════════════════════════════════════════════════════════════════════════════

/** Outcome of GET /health through the bridge. */
data class NodeHealth(
    val nodeOnline: Boolean,
    val ok: Boolean,
    val error: String?,
    val hint: String?,
    /** Node /health payload when the node answered (status/version/network...). */
    val nodeData: NodeHealthInfo?,
)

/** Fields of the node's /health payload that the dashboard shows honestly. */
data class NodeHealthInfo(
    val status: String?,
    val version: String?,
    val chainId: Long?,
    val network: String?,
)

/** Balance outcome. `balanceHsmc` is non-null ONLY when the node returned it. */
data class BalanceResult(
    val available: Boolean,
    val balanceHsmc: Double?,
    val utxoCount: Int?,
    val reason: String?,
)

/** Submit outcome. Mirrors the web frontend's SubmitTxResult semantics. */
data class TxSubmitResult(
    /** Real node tx hash, or null when nothing reached the chain. */
    val txHash: String?,
    /** 'pending' → node accepted with a real tx_hash; 'submitted' → attempt failed. */
    val status: String,
    val error: String?,
    /** The node's raw error message when it rejected the tx (e.g. fee/validation). */
    val nodeError: String?,
)

/** GET /tx/{hash} outcome. */
data class TxLookupResult(
    val found: Boolean,
    val location: String?,
    val blockNumber: Long?,
    val error: String?,
)

/** Address transaction listing outcome. */
data class AddressTxsResult(
    val available: Boolean,
    val total: Int?,
    val transactions: List<AddressTxEntry>,
    val reason: String?,
)

/** A single transaction entry as returned by the node. */
data class AddressTxEntry(
    val txHash: String,
    val confirmed: Boolean,
    /** The node's own `location` field: "mempool" for pending entries, absent for confirmed. */
    val location: String?,
    val blockNumber: Long?,
    val blockHash: String?,
)

/**
 * Request payload for POST /tx/submit. Field names mirror the Rust
 * SubmitTxRequest (rust-node/hsmc-rpc/src/types.rs) exactly.
 */
data class SubmitTxPayload(
    val from: String,
    val to: String,
    val amount: Double,
    val fee: Double,
    val privacyLevel: String,
    val memo: String? = null,
    val nonce: Long? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("from", from)
        put("to", to)
        put("amount", amount)
        put("fee", fee)
        put("privacy_level", privacyLevel)
        // Optional fields are omitted when null, matching the TS submit payload.
        memo?.let { put("memo", it) }
        nonce?.let { put("nonce", it) }
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// Parsers — internal so the unit tests can exercise them against the REAL server and
// node response shapes (see app/src/test/.../NodeClientParsingTest.kt).
// ════════════════════════════════════════════════════════════════════════════════

/** Parses a raw bridge response body into [NodeHealth]. */
internal fun parseHealthEnvelope(body: JSONObject?, httpCode: Int = 200): NodeHealth {
    if (body == null) {
        return NodeHealth(
            nodeOnline = false, ok = false,
            error = "HSMC API server not reachable", hint = null, nodeData = null,
        )
    }
    if (isUnauthorized(httpCode, body.optStringOrNull("error"))) {
        return NodeHealth(
            nodeOnline = false, ok = false,
            error = UNAUTHORIZED_REASON, hint = null, nodeData = null,
        )
    }
    val ok = body.optBoolean("ok", false)
    val nodeOnline = body.optBoolean("node_online", false)
    val error = body.optStringOrNull("error")
    val hint = body.optStringOrNull("hint")
    var info: NodeHealthInfo? = null
    if (nodeOnline && body.has("data") && !body.isNull("data")) {
        val data = body.optJSONObject("data")
        if (data != null) {
            info = NodeHealthInfo(
                status = data.optStringOrNull("status"),
                version = data.optStringOrNull("version"),
                chainId = if (data.has("chain_id")) data.optLong("chain_id") else null,
                network = data.optStringOrNull("network"),
            )
        }
    }
    return NodeHealth(nodeOnline = nodeOnline && ok, ok = ok, error = error, hint = hint, nodeData = info)
}

/** Parses the /utxo/{address} bridge response into [BalanceResult]. */
internal fun parseBalanceResult(body: JSONObject?, httpCode: Int = 200): BalanceResult {
    val envelope = unwrapEnvelope(body) ?: return BalanceResult(
        available = false, balanceHsmc = null, utxoCount = null,
        reason = "Balance unavailable — HSMC API server not reachable",
    )
    // Server rejected the request as unauthorized: this is a real auth state, not an
    // offline node — no misleading "node offline" claim.
    if (isUnauthorized(httpCode, envelope.error)) {
        return BalanceResult(
            available = false, balanceHsmc = null, utxoCount = null,
            reason = "Balance unavailable — $UNAUTHORIZED_REASON",
        )
    }
    // Node offline, or the server rejected the path (HTTP 400).
    if (!envelope.nodeOnline) {
        return BalanceResult(
            available = false, balanceHsmc = null, utxoCount = null,
            reason = "Balance unavailable — node offline${envelope.error?.let { ": $it" } ?: ""}",
        )
    }
    val data = envelope.data ?: return BalanceResult(
        available = false, balanceHsmc = null, utxoCount = null,
        reason = "Balance unavailable — no balance data returned by the node",
    )
    // Node-level error object.
    data.optStringOrNull("error")?.let { err ->
        return BalanceResult(
            available = false, balanceHsmc = null, utxoCount = null,
            reason = "Balance unavailable — node error: $err",
        )
    }
    if (!data.has("total_balance")) {
        return BalanceResult(
            available = false, balanceHsmc = null, utxoCount = null,
            reason = "Balance unavailable — node returned no total_balance for this address",
        )
    }
    val balance = data.optDouble("total_balance", Double.NaN)
    if (balance.isNaN()) {
        return BalanceResult(
            available = false, balanceHsmc = null, utxoCount = null,
            reason = "Balance unavailable — node returned a malformed balance",
        )
    }
    return BalanceResult(
        available = true,
        balanceHsmc = balance,
        utxoCount = if (data.has("utxo_count")) data.optInt("utxo_count") else null,
        reason = null,
    )
}

/** Parses the /tx/submit bridge response into [TxSubmitResult]. */
internal fun parseSubmitResult(body: JSONObject?, httpCode: Int = 200): TxSubmitResult {
    val envelope = unwrapEnvelope(body) ?: return TxSubmitResult(
        txHash = null, status = "submitted",
        error = "HSMC API server not reachable — transaction not sent", nodeError = null,
    )
    // Real auth state, not an offline node — surfaced honestly so the operator knows
    // the /node-proxy request was rejected for a missing/invalid x-api-key.
    if (isUnauthorized(httpCode, envelope.error)) {
        return TxSubmitResult(
            txHash = null, status = "submitted",
            error = "$UNAUTHORIZED_REASON — transaction not sent", nodeError = null,
        )
    }
    if (!envelope.nodeOnline) {
        val detail = envelope.error ?: "HSMC node not connected"
        return TxSubmitResult(
            txHash = null, status = "submitted",
            error = "Submission failed — $detail${envelope.hint?.let { " ($it)" } ?: ""}",
            nodeError = detail,
        )
    }
    val data = envelope.data
    if (data == null) {
        return TxSubmitResult(
            txHash = null, status = "submitted",
            error = "Node accepted the request but returned no response data", nodeError = null,
        )
    }
    data.optStringOrNull("error")?.let { err ->
        // Node rejected the tx (self-transfer, bad amount, low fee, invalid address...).
        return TxSubmitResult(
            txHash = null, status = "submitted",
            error = "Submission failed: $err", nodeError = err,
        )
    }
    val hash = data.optStringOrNull("tx_hash")
    if (hash.isNullOrBlank()) {
        return TxSubmitResult(
            txHash = null, status = "submitted",
            error = "Node accepted the request but returned no transaction hash", nodeError = null,
        )
    }
    return TxSubmitResult(txHash = hash, status = "pending", error = null, nodeError = null)
}

/** Parses the GET /tx/{hash} bridge response into [TxLookupResult]. */
internal fun parseTxLookupResult(body: JSONObject?, httpCode: Int = 200): TxLookupResult {
    val envelope = unwrapEnvelope(body) ?: return TxLookupResult(
        found = false, location = null, blockNumber = null,
        error = "Transaction status unavailable — HSMC API server not reachable",
    )
    if (isUnauthorized(httpCode, envelope.error)) {
        return TxLookupResult(
            found = false, location = null, blockNumber = null,
            error = "Transaction status unavailable — $UNAUTHORIZED_REASON",
        )
    }
    if (!envelope.nodeOnline) {
        return TxLookupResult(
            found = false, location = null, blockNumber = null,
            error = "Transaction status unavailable — node offline",
        )
    }
    val data = envelope.data ?: return TxLookupResult(
        found = false, location = null, blockNumber = null,
        error = "Transaction status unavailable — no data returned by the node",
    )
    val found = data.optBoolean("found", false)
    if (!found) {
        return TxLookupResult(
            found = false, location = null, blockNumber = null,
            error = data.optStringOrNull("error") ?: "Transaction not found on this node",
        )
    }
    return TxLookupResult(
        found = true,
        location = data.optStringOrNull("location"),
        blockNumber = if (data.has("block_number")) data.optLong("block_number") else null,
        error = null,
    )
}

/** Parses the /address/{address}/txs bridge response into [AddressTxsResult]. */
internal fun parseAddressTxsResult(body: JSONObject?, httpCode: Int = 200): AddressTxsResult {
    val envelope = unwrapEnvelope(body) ?: return AddressTxsResult(
        available = false, total = null, transactions = emptyList(),
        reason = "History unavailable — HSMC API server not reachable",
    )
    if (isUnauthorized(httpCode, envelope.error)) {
        return AddressTxsResult(
            available = false, total = null, transactions = emptyList(),
            reason = "History unavailable — $UNAUTHORIZED_REASON",
        )
    }
    if (!envelope.nodeOnline) {
        return AddressTxsResult(
            available = false, total = null, transactions = emptyList(),
            reason = "History unavailable — node offline",
        )
    }
    val data = envelope.data ?: return AddressTxsResult(
        available = false, total = null, transactions = emptyList(),
        reason = "History unavailable — no data returned by the node",
    )
    data.optStringOrNull("error")?.let { err ->
        return AddressTxsResult(
            available = false, total = null, transactions = emptyList(),
            reason = "History unavailable — node error: $err",
        )
    }
    if (!data.has("transactions")) {
        return AddressTxsResult(
            available = false, total = null, transactions = emptyList(),
            reason = "History unavailable — node returned no transactions list",
        )
    }
    val txs = data.optJSONArray("transactions") ?: JSONArray()
    val entries = ArrayList<AddressTxEntry>(txs.length())
    for (i in 0 until txs.length()) {
        val tx = txs.optJSONObject(i) ?: continue
        // The node emits two different shapes in the same listing (handlers.rs
        // get_address_txs): confirmed entries are built by hand with `tx_hash`,
        // while mempool (pending) entries are the full Transaction struct whose
        // consensus hash field is `hash` (rust-node/hsmc-core/src/transaction.rs :629).
        // Accept BOTH and never drop a pending entry; label each with the node's own
        // `confirmed` boolean (it emits it on both shapes) + `location` when present.
        val hash = tx.optStringOrNull("tx_hash") ?: tx.optStringOrNull("hash") ?: continue
        entries.add(
            AddressTxEntry(
                txHash = hash,
                confirmed = tx.optBoolean("confirmed", false),
                location = tx.optStringOrNull("location"),
                blockNumber = if (tx.has("block_number")) tx.optLong("block_number") else null,
                blockHash = tx.optStringOrNull("block_hash"),
            )
        )
    }
    return AddressTxsResult(
        available = true,
        total = if (data.has("total")) data.optInt("total") else entries.size,
        transactions = entries,
        reason = null,
    )
}

/** Unwraps { ok, node_online, data } or a plain { error } (e.g. HTTP 400/401 rejection). */
private fun unwrapEnvelope(body: JSONObject?): Envelope? {
    if (body == null) return null
    if (body.has("ok")) {
        return Envelope(
            nodeOnline = body.optBoolean("node_online", false),
            error = body.optStringOrNull("error"),
            hint = body.optStringOrNull("hint"),
            data = body.optJSONObject("data"),
        )
    }
    // Plain { error } (e.g. HTTP 400 "Path ... is not allowed via /node-proxy").
    return Envelope(
        nodeOnline = false,
        error = body.optStringOrNull("error") ?: "API server rejected the request",
        hint = null,
        data = null,
    )
}

private data class Envelope(
    val nodeOnline: Boolean,
    val error: String?,
    val hint: String?,
    val data: JSONObject?,
)

/** Honest reason shown when the production /node-proxy rejects a missing/invalid x-api-key. */
internal const val UNAUTHORIZED_REASON: String = "Unauthorized — configure API key"

/**
 * True when the bridge rejected the request for a missing/invalid x-api-key. The
 * production server answers HTTP 401 with a plain `{ error: "Unauthorized" }` body
 * (server/api-server.ts:3256-3260); we detect that by status code and, defensively,
 * by the error string, so a real auth failure is never mislabelled "node offline".
 */
internal fun isUnauthorized(httpCode: Int, envelopeError: String?): Boolean =
    httpCode == 401 || (envelopeError != null && envelopeError == "Unauthorized")

private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key) else null

/** Formats an HSMC amount with exactly 8 decimals (0.00000000-style), like the node's f64. */
internal fun formatHsmcAmount(amount: Double): String {
    val scaled = BigDecimal(amount.toString()).setScale(8, java.math.RoundingMode.DOWN)
    return scaled.toPlainString()
}
