package com.hsmc.wallet.network

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the NodeClient JSON parsing, using the REAL response shapes from
 * the API server (server/api-server.ts) and the Rust node (rust-node/hsmc-rpc/).
 *
 * These are the honest contract tests: if the server or node change a field name,
 * these tests fail and the app would show "unavailable" instead of misreading data.
 */
class NodeClientParsingTest {

    // ── GET /health through the bridge ─────────────────────────────────────────

    /** Real shape: server wraps the node's /health in { ok, node_online, data }. */
    @Test
    fun `health envelope with online node parses node data`() {
        val body = JSONObject(
            """
            {
              "ok": true,
              "node_online": true,
              "data": {
                "status": "ok",
                "node": "hsmc-node",
                "version": "0.3.0",
                "chain_id": 8888,
                "network": "mainnet",
                "uptime_epoch": 1700000000,
                "capabilities": ["ringct", "stealth"]
              }
            }
            """.trimIndent()
        )
        val health = parseHealthEnvelope(body)
        assertTrue(health.nodeOnline)
        assertTrue(health.ok)
        assertEquals("ok", health.nodeData?.status)
        assertEquals("0.3.0", health.nodeData?.version)
        assertEquals(8888L, health.nodeData?.chainId)
        assertEquals("mainnet", health.nodeData?.network)
    }

    /** Real shape: server returns { ok:false, node_online:false, error, hint } when the Rust node is down. */
    @Test
    fun `health envelope with offline node surfaces reason`() {
        val body = JSONObject(
            """
            {
              "ok": false,
              "node_online": false,
              "error": "HSMC node not connected",
              "hint": "Ensure the Rust node is running on port 8080 and reachable from the API server."
            }
            """.trimIndent()
        )
        val health = parseHealthEnvelope(body)
        assertFalse(health.nodeOnline)
        assertEquals("HSMC node not connected", health.error)
        assertEquals("Ensure the Rust node is running on port 8080 and reachable from the API server.", health.hint)
        assertNull(health.nodeData)
    }

    @Test
    fun `health envelope with null body means api server unreachable`() {
        val health = parseHealthEnvelope(null)
        assertFalse(health.nodeOnline)
        assertEquals("HSMC API server not reachable", health.error)
    }

    // ── Balance: node GET /utxo/{address} shape ───────────────────────────────

    /** Real node response: { address, utxo_count, total_balance, total_balance_units, utxos } (handlers.rs get_utxo_set). */
    @Test
    fun `balance parses real node utxo response`() {
        val body = JSONObject(
            """
            {
              "ok": true,
              "node_online": true,
              "data": {
                "address": "HSMC00112233445566778899aabbccddeeff00112233",
                "utxo_count": 2,
                "total_balance": 12.5,
                "total_balance_units": 1250000000,
                "utxos": [
                  { "tx_hash": "aabb", "vout": 0, "amount": 7.5, "commitment": null,
                    "block_number": 42, "confirmations": 3, "spendable": true, "coinbase": false },
                  { "tx_hash": "ccdd", "vout": 1, "amount": 5.0, "commitment": null,
                    "block_number": 43, "confirmations": 2, "spendable": true, "coinbase": false }
                ]
              }
            }
            """.trimIndent()
        )
        val result = parseBalanceResult(body)
        assertTrue(result.available)
        assertEquals(12.5, result.balanceHsmc!!, 1e-9)
        assertEquals(2, result.utxoCount)
        assertNull(result.reason)
    }

    /** Node returned zero — a real zero, shown as 0.00000000 only because the node said so. */
    @Test
    fun `balance zero from node is available with zero value`() {
        val body = JSONObject(
            """
            {
              "ok": true,
              "node_online": true,
              "data": { "address": "HSMCaa", "utxo_count": 0, "total_balance": 0.0, "total_balance_units": 0, "utxos": [] }
            }
            """.trimIndent()
        )
        val result = parseBalanceResult(body)
        assertTrue(result.available)
        assertEquals(0.0, result.balanceHsmc!!, 1e-9)
        assertEquals(0, result.utxoCount)
    }

    /** Node offline: balance must NOT be invented. */
    @Test
    fun `balance with node offline is unavailable`() {
        val body = JSONObject(
            """
            {
              "ok": false,
              "node_online": false,
              "error": "HSMC node not connected",
              "hint": "Ensure the Rust node is running."
            }
            """.trimIndent()
        )
        val result = parseBalanceResult(body)
        assertFalse(result.available)
        assertNull(result.balanceHsmc)
        assertTrue(result.reason!!.contains("node offline"))
    }

    /** A plain { error } server rejection is surfaced honestly instead of inventing a balance. */
    @Test
    fun `balance with server rejection is unavailable with reason`() {
        val body = JSONObject(
            """{ "error": "Path GET /utxo/HSMCaa is not allowed via /node-proxy" }""".trimIndent()
        )
        val result = parseBalanceResult(body)
        assertFalse(result.available)
        assertNull(result.balanceHsmc)
        assertEquals(
            "Balance unavailable — node offline: Path GET /utxo/HSMCaa is not allowed via /node-proxy",
            result.reason
        )
    }

    // ── Submit: node POST /tx/submit shape ────────────────────────────────────

    /** Real success shape: { tx_hash, status, privacy, min_fee, estimated_confirmation }. */
    @Test
    fun `submit success returns real tx hash`() {
        val body = JSONObject(
            """
            {
              "ok": true,
              "node_online": true,
              "data": {
                "tx_hash": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
                "status": "pending",
                "privacy": "transparent",
                "min_fee": 0.0001,
                "estimated_confirmation": "~2 blocks (~4 minutes)"
              }
            }
            """.trimIndent()
        )
        val result = parseSubmitResult(body)
        assertEquals("pending", result.status)
        assertEquals(
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            result.txHash
        )
        assertNull(result.error)
    }

    /** Real rejection shape: node answers { error: "..." } — surfaced, no hash fabricated. */
    @Test
    fun `submit rejection surfaces node error without hash`() {
        val body = JSONObject(
            """
            { "ok": true, "node_online": true, "data": { "error": "Self-transfers not allowed" } }
            """.trimIndent()
        )
        val result = parseSubmitResult(body)
        assertNull(result.txHash)
        assertEquals("submitted", result.status)
        assertEquals("Submission failed: Self-transfers not allowed", result.error)
        assertEquals("Self-transfers not allowed", result.nodeError)
    }

    /** Node offline: mirror node-tx.ts — refuse, never fabricate. */
    @Test
    fun `submit with node offline fails honestly`() {
        val body = JSONObject(
            """{ "ok": false, "node_online": false, "error": "HSMC node not connected" }""".trimIndent()
        )
        val result = parseSubmitResult(body)
        assertNull(result.txHash)
        assertEquals("submitted", result.status)
        assertTrue(result.error!!.contains("HSMC node not connected"))
    }

    /** HTTP 400 whitelist rejection of /tx/submit (should not happen — it IS whitelisted — but be honest anyway). */
    @Test
    fun `submit with server rejection fails honestly`() {
        val body = JSONObject("""{ "error": "Path POST /tx/submit is not allowed via /node-proxy" }""".trimIndent())
        val result = parseSubmitResult(body)
        assertNull(result.txHash)
        assertTrue(result.error!!.contains("not allowed via /node-proxy"))
    }

    // ── GET /tx/{hash} shape ───────────────────────────────────────────────────

    /** Real confirmed shape from get_tx (handlers.rs): { found, location, block_number, block_hash, tx }. */
    @Test
    fun `tx lookup parses confirmed transaction`() {
        val body = JSONObject(
            """
            {
              "ok": true, "node_online": true,
              "data": {
                "found": true, "location": "confirmed",
                "block_number": 42, "block_hash": "deadbeef",
                "tx": { "hash": "abc" }
              }
            }
            """.trimIndent()
        )
        val result = parseTxLookupResult(body)
        assertTrue(result.found)
        assertEquals("confirmed", result.location)
        assertEquals(42L, result.blockNumber)
    }

    /** Real not-found shape: { found: false, error: "Transaction not found" }. */
    @Test
    fun `tx lookup not found is honest`() {
        val body = JSONObject(
            """{ "ok": true, "node_online": true, "data": { "found": false, "error": "Transaction not found" } }""".trimIndent()
        )
        val result = parseTxLookupResult(body)
        assertFalse(result.found)
        assertEquals("Transaction not found", result.error)
    }

    // ── Address transaction listing shape ──────────────────────────────────────

    /**
     * Real shape from get_address_txs (rust-node/hsmc-rpc/src/handlers.rs):
     * { address, total, limit, offset, transactions }. Confirmed entries carry `tx_hash`
     * (+ block_number/block_hash/confirmed:true); mempool (pending) entries are the full
     * Transaction struct whose consensus hash field is `hash` (transaction.rs :629) plus
     * confirmed:false and location:"mempool". Both must render.
     */
    @Test
    fun `address txs parses real node entries`() {
        val body = JSONObject(
            """
            {
              "ok": true, "node_online": true,
              "data": {
                "address": "HSMCaa",
                "total": 2,
                "limit": 50,
                "offset": 0,
                "transactions": [
                  { "tx_hash": "1111", "block_number": 42, "block_hash": "beef", "confirmed": true },
                  { "hash": "2222", "from_address": "HSMCaa", "to_address": "HSMCbb",
                    "amount": 1.5, "fee": 0.0001, "status": "Pending", "created_at": 123,
                    "confirmed_at": null, "block_number": null, "inputs": [], "outputs": [],
                    "privacy_level": "transparent", "confirmed": false, "location": "mempool" }
                ]
              }
            }
            """.trimIndent()
        )
        val result = parseAddressTxsResult(body)
        assertTrue(result.available)
        assertEquals(2, result.total)
        assertEquals(2, result.transactions.size)
        // Confirmed entry rendered from tx_hash.
        assertEquals("1111", result.transactions[0].txHash)
        assertTrue(result.transactions[0].confirmed)
        assertEquals(42L, result.transactions[0].blockNumber)
        assertEquals("beef", result.transactions[0].blockHash)
        // Pending (mempool) entry rendered from the Transaction struct's `hash` field.
        assertEquals("2222", result.transactions[1].txHash)
        assertFalse(result.transactions[1].confirmed)
        assertEquals("mempool", result.transactions[1].location)
        assertNull(result.transactions[1].blockNumber)
    }

    /**
     * Regression across the real node shape: a pending (mempool) entry serializes the
     * Transaction struct with `hash` (NOT `tx_hash`). The parser must NOT drop it —
     * this is the Blocker 2 fix (previously such entries silently vanished from History).
     */
    @Test
    fun `address txs renders a pending mempool entry using its hash field`() {
        val body = JSONObject(
            """
            {
              "ok": true, "node_online": true,
              "data": {
                "address": "HSMCaa",
                "total": 1,
                "limit": 50,
                "offset": 0,
                "transactions": [
                  { "id": "uuid-1", "hash": "abc123", "version": 1,
                    "from_address": "HSMCaa", "to_address": "HSMCbb",
                    "amount": 0.5, "fee": 0.0001, "status": "Pending", "created_at": 999,
                    "confirmed_at": null, "block_number": null,
                    "inputs": [], "outputs": [], "privacy_level": "transparent",
                    "confirmed": false, "location": "mempool" }
                ]
              }
            }
            """.trimIndent()
        )
        val result = parseAddressTxsResult(body)
        assertTrue(result.available)
        assertEquals(1, result.transactions.size)
        assertEquals("abc123", result.transactions[0].txHash)
        assertFalse(result.transactions[0].confirmed)
        assertEquals("mempool", result.transactions[0].location)
    }

    /** A transaction with neither tx_hash nor hash is skipped — never fabricated. */
    @Test
    fun `address txs skips entries missing both hash fields`() {
        val body = JSONObject(
            """
            {
              "ok": true, "node_online": true,
              "data": { "address": "HSMCaa", "total": 1, "limit": 50, "offset": 0,
                "transactions": [ { "amount": 1.0, "confirmed": true } ] }
            }
            """.trimIndent()
        )
        val result = parseAddressTxsResult(body)
        assertTrue(result.available)
        assertEquals(0, result.transactions.size)
    }

    @Test
    fun `address txs offline is unavailable`() {
        val body = JSONObject("""{ "ok": false, "node_online": false, "error": "HSMC node not connected" }""".trimIndent())
        val result = parseAddressTxsResult(body)
        assertFalse(result.available)
        assertTrue(result.transactions.isEmpty())
        assertTrue(result.reason!!.contains("node offline"))
    }

    /** A plain { error } rejection (e.g. "Path ... is not allowed via /node-proxy") is surfaced honestly. */
    @Test
    fun `address txs server rejection is unavailable with reason`() {
        val body = JSONObject("""{ "error": "Path GET /address/HSMCaa/txs is not allowed via /node-proxy" }""".trimIndent())
        val result = parseAddressTxsResult(body)
        assertFalse(result.available)
        assertTrue(result.reason!!.contains("node offline"))
    }

    // ── x-api-key (production /node-proxy auth) ───────────────────────────────

    @Test
    fun `proxy headers include x-api-key when a key is configured`() {
        val headers = buildProxyHeaders("super-secret-operator-key")
        assertEquals("super-secret-operator-key", headers["x-api-key"])
    }

    @Test
    fun `proxy headers omit x-api-key when no key is configured`() {
        val headers = buildProxyHeaders(null)
        assertFalse(headers.containsKey("x-api-key"))
        val blank = buildProxyHeaders("   ")
        assertFalse(blank.containsKey("x-api-key"))
    }

    @Test
    fun `proxy headers keep content-type and accept on every request`() {
        val headers = buildProxyHeaders(null)
        assertEquals("application/json", headers["Content-Type"])
        assertEquals("application/json", headers["Accept"])
    }

    /**
     * Production server rejects a missing/wrong x-api-key with HTTP 401
     * { error: "Unauthorized" } (server/api-server.ts:3256-3260). The parser must
     * surface the honest "Unauthorized — configure API key" reason, never a misleading
     * "node offline".
     */
    @Test
    fun `401 envelope parses to honest unauthorized reason for balance`() {
        val body = JSONObject("""{ "error": "Unauthorized" }""".trimIndent())
        val result = parseBalanceResult(body, httpCode = 401)
        assertFalse(result.available)
        assertNull(result.balanceHsmc)
        assertTrue(result.reason!!.contains("Unauthorized — configure API key"))
        assertFalse(result.reason!!.contains("node offline"))
    }

    @Test
    fun `401 envelope parses to honest unauthorized reason for history`() {
        val body = JSONObject("""{ "error": "Unauthorized" }""".trimIndent())
        val result = parseAddressTxsResult(body, httpCode = 401)
        assertFalse(result.available)
        assertTrue(result.transactions.isEmpty())
        assertTrue(result.reason!!.contains("Unauthorized — configure API key"))
        assertFalse(result.reason!!.contains("node offline"))
    }

    @Test
    fun `401 envelope parses to honest unauthorized reason for submit`() {
        val body = JSONObject("""{ "error": "Unauthorized" }""".trimIndent())
        val result = parseSubmitResult(body, httpCode = 401)
        assertNull(result.txHash)
        assertTrue(result.error!!.contains("Unauthorized — configure API key"))
    }

    @Test
    fun `401 envelope surfaces unauthorized on health`() {
        val body = JSONObject("""{ "error": "Unauthorized" }""".trimIndent())
        val health = parseHealthEnvelope(body, httpCode = 401)
        assertFalse(health.nodeOnline)
        assertTrue(health.error!!.contains("Unauthorized — configure API key"))
    }

    /** Defensive: even without the 401 status code, an "Unauthorized" error is caught. */
    @Test
    fun `Unauthorized error string alone is detected without 401 status`() {
        val body = JSONObject("""{ "error": "Unauthorized" }""".trimIndent())
        val result = parseBalanceResult(body, httpCode = 200)
        assertFalse(result.available)
        assertTrue(result.reason!!.contains("Unauthorized — configure API key"))
    }

    /** A 200 envelope that is NOT unauthorized must not be mislabelled as auth failure. */
    @Test
    fun `non-401 node offline is not mislabelled as unauthorized`() {
        val body = JSONObject(
            """{ "ok": false, "node_online": false, "error": "HSMC node not connected" }""".trimIndent()
        )
        val result = parseBalanceResult(body, httpCode = 200)
        assertFalse(result.available)
        assertTrue(result.reason!!.contains("node offline"))
        assertFalse(result.reason!!.contains("Unauthorized"))
    }

    // ── SubmitTxPayload JSON shape (must match Rust SubmitTxRequest field names) ─

    @Test
    fun `submit payload field names match the rust SubmitTxRequest`() {
        val payload = SubmitTxPayload(
            from = "HSMCaa",
            to = "HSMCbb",
            amount = 1.5,
            fee = 0.0001,
            privacyLevel = "transparent",
            memo = "hello",
            nonce = 7L
        )
        val json = payload.toJson()
        assertEquals("HSMCaa", json.getString("from"))
        assertEquals("HSMCbb", json.getString("to"))
        assertEquals(1.5, json.getDouble("amount"), 1e-9)
        assertEquals(0.0001, json.getDouble("fee"), 1e-9)
        assertEquals("transparent", json.getString("privacy_level"))
        assertEquals("hello", json.getString("memo"))
        assertEquals(7L, json.getLong("nonce"))
    }

    @Test
    fun `submit payload omits null optional fields`() {
        val payload = SubmitTxPayload(
            from = "HSMCaa", to = "HSMCbb", amount = 1.0,
            fee = 0.0001, privacyLevel = "transparent"
        )
        val json = payload.toJson()
        assertFalse(json.has("memo"))
        assertFalse(json.has("nonce"))
        assertFalse(json.has("ring_signature"))
    }

    // ── Formatting ─────────────────────────────────────────────────────────────

    @Test
    fun `formatHsmcAmount prints exactly 8 decimals`() {
        assertEquals("0.00000000", formatHsmcAmount(0.0))
        assertEquals("12.50000000", formatHsmcAmount(12.5))
        assertEquals("0.00010000", formatHsmcAmount(0.0001))
    }
}
