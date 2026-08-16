package com.hsmc.wallet.network

import android.content.Context
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
 * Real node connectivity for the HSMC wallet (Phase 3, step 1).
 *
 * This client talks to the HSMC Rust node EXCLUSIVELY through the API server's
 * /node-proxy bridge — the ONE sanctioned path (server/api-server.ts, `handleNodeProxy`
 * + `NODE_PROXY_WHITELIST`). Every call is a POST to `{apiBaseUrl}/node-proxy` with the
 * envelope `{ path, method, data }`, mirroring the web frontend's `node-tx.ts`.
 *
 * The bridge answers with the envelope `{ ok, node_online, data }` (HTTP 200) when the
 * forwarded node call succeeded, `{ ok:false, node_online:false, error, hint }` (HTTP 200)
 * when the Rust node is unreachable, or a plain `{ error }` (HTTP 400) when the requested
 * path is not in the server's whitelist. All three are surfaced honestly here — nothing
 * is ever fabricated (no fake balances, hashes, confirmations or addresses).
 *
 * Current server contract (server/api-server.ts lines ~3706-3717, 3742):
 *   whitelisted: GET /health, POST /tx/submit, POST /tx/broadcast,
 *                POST /crypto/stealth/generate, POST /crypto/commitment,
 *                POST /crypto/ring-sign, POST /crypto/range-proof,
 *                GET /tx/{hash} (1-128 alphanumeric chars).
 *   NOT yet whitelisted (contract gap, documented in the Phase 3 PR): the node's
 *   GET /utxo/{address} (balance) and GET /address/{address}/txs (history). The client
 *   still calls the real node paths through the envelope so it starts working the moment
 *   the server adds them, and surfaces the server's real "not allowed" rejection as an
 *   honest "unavailable" state instead of inventing data.
 *
 * Security posture: no secrets, no request logging of payloads/addresses, TLS to the API
 * server (cleartext to arbitrary hosts remains blocked outside the debug-only network
 * security config), and the configured node URL is never dialed directly.
 */
class NodeClient private constructor(
    private val apiBaseUrl: String,
    val configuredNodeUrl: String,
) {
    /** True when the Rust node behind the API bridge reported node_online=true. */
    suspend fun isNodeOnline(): Boolean = checkHealth().nodeOnline

    /**
     * GET /health through the bridge. Returns the envelope fields plus the node's
     * health payload (status, version, chain_id, network) when the node is reachable.
     */
    suspend fun checkHealth(): NodeHealth = withContext(Dispatchers.IO) {
        parseHealthEnvelope(postProxy("/health", "GET", null))
    }

    /**
     * Balance query: GET /utxo/{address} through the bridge (the node's authoritative
     * UTXO-set endpoint, rust-node/hsmc-rpc/src/server.rs line 96). The server does not
     * whitelist it yet, so today this surfaces the server's real rejection as an honest
     * "unavailable" — never a fabricated 0.00000000.
     */
    suspend fun fetchBalance(address: String): BalanceResult = withContext(Dispatchers.IO) {
        parseBalanceResult(postProxy("/utxo/$address", "GET", null))
    }

    /**
     * Submit a transaction: POST /tx/submit through the bridge. Mirrors the web
     * frontend's submitTransaction (src/utils/node-tx.ts): a real tx_hash is returned
     * only when the node accepted the tx into its mempool; every other outcome carries
     * the node's/server's real error string.
     */
    suspend fun submitTransaction(payload: SubmitTxPayload): TxSubmitResult =
        withContext(Dispatchers.IO) {
            parseSubmitResult(postProxy("/tx/submit", "POST", payload.toJson()))
        }

    /**
     * Look up a transaction: GET /tx/{hash} through the bridge (whitelisted). Returns
     * the real location (mempool/confirmed) + block number when the node knows the tx.
     */
    suspend fun getTransaction(hash: String): TxLookupResult = withContext(Dispatchers.IO) {
        parseTxLookupResult(postProxy("/tx/$hash", "GET", null))
    }

    /**
     * Address transaction listing: GET /address/{address}/txs through the bridge (the
     * node's endpoint, rust-node/hsmc-rpc/src/server.rs line 94). Not whitelisted yet —
     * see class doc. Only entries the node actually returns are ever shown.
     */
    suspend fun fetchAddressTransactions(address: String): AddressTxsResult =
        withContext(Dispatchers.IO) {
            parseAddressTxsResult(postProxy("/address/$address/txs", "GET", null))
        }

    // ────────────────────────────────────────────────────────────────────────────
    // Transport
    // ────────────────────────────────────────────────────────────────────────────

    /**
     * Sends the { path, method, data } envelope to the bridge.
     * Returns the parsed JSON body on any HTTP response (2xx/4xx), or null when the API
     * server itself is unreachable (DNS/TLS/connect failure — the node is unreachable by
     * definition then).
     */
    private fun postProxy(path: String, method: String, data: JSONObject?): JSONObject? {
        val url = URL("${apiBaseUrl.trimEnd('/')}${AppConstants.NODE_PROXY_PATH}")
        var conn: HttpURLConnection? = null
        try {
            conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
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
            return if (body.isBlank()) null else JSONObject(body)
        } catch (e: JSONException) {
            // Malformed JSON from the server: treat as server error, never fabricate.
            return JSONObject().put("error", "Malformed response from API server: ${e.message}")
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

        /**
         * Builds a NodeClient bound to the live API server, reading the persisted node
         * URL setting for honest status copy. The configured node is NEVER dialed
         * directly — all traffic goes through the sanctioned /node-proxy bridge.
         */
        fun create(context: Context): NodeClient {
            val prefs = SecurePrefs(context.applicationContext)
            val nodeUrl = prefs.getString(SecurePrefs.KEY_NODE_URL)
                ?.takeIf { it.isNotBlank() }
                ?: AppConstants.DEFAULT_NODE_URL
            return NodeClient(AppConstants.API_BASE_URL, nodeUrl)
        }
    }
}

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
internal fun parseHealthEnvelope(body: JSONObject?): NodeHealth {
    if (body == null) {
        return NodeHealth(
            nodeOnline = false, ok = false,
            error = "HSMC API server not reachable", hint = null, nodeData = null,
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
internal fun parseBalanceResult(body: JSONObject?): BalanceResult {
    val envelope = unwrapEnvelope(body) ?: return BalanceResult(
        available = false, balanceHsmc = null, utxoCount = null,
        reason = "Balance unavailable — HSMC API server not reachable",
    )
    // Server rejected the path (not whitelisted yet) or another HTTP error.
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
            reason = "Balance unavailable — server does not expose a balance endpoint via /node-proxy (contract gap)",
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
internal fun parseSubmitResult(body: JSONObject?): TxSubmitResult {
    val envelope = unwrapEnvelope(body) ?: return TxSubmitResult(
        txHash = null, status = "submitted",
        error = "HSMC API server not reachable — transaction not sent", nodeError = null,
    )
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
internal fun parseTxLookupResult(body: JSONObject?): TxLookupResult {
    val envelope = unwrapEnvelope(body) ?: return TxLookupResult(
        found = false, location = null, blockNumber = null,
        error = "Transaction status unavailable — HSMC API server not reachable",
    )
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
internal fun parseAddressTxsResult(body: JSONObject?): AddressTxsResult {
    val envelope = unwrapEnvelope(body) ?: return AddressTxsResult(
        available = false, total = null, transactions = emptyList(),
        reason = "History unavailable — HSMC API server not reachable",
    )
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
            reason = "History unavailable — server does not expose address transactions via /node-proxy (contract gap)",
        )
    }
    val txs = data.optJSONArray("transactions") ?: JSONArray()
    val entries = ArrayList<AddressTxEntry>(txs.length())
    for (i in 0 until txs.length()) {
        val tx = txs.optJSONObject(i) ?: continue
        val hash = tx.optStringOrNull("tx_hash") ?: continue
        entries.add(
            AddressTxEntry(
                txHash = hash,
                confirmed = tx.optBoolean("confirmed", false),
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

/** Unwraps { ok, node_online, data } or { error } from an HTTP 400 rejection. */
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

private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key) else null

/** Formats an HSMC amount with exactly 8 decimals (0.00000000-style), like the node's f64. */
internal fun formatHsmcAmount(amount: Double): String {
    val scaled = BigDecimal(amount.toString()).setScale(8, java.math.RoundingMode.DOWN)
    return scaled.toPlainString()
}
