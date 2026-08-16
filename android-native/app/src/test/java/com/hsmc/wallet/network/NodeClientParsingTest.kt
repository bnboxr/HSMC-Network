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

    /**
     * Today the server's /node-proxy whitelist does NOT include /utxo/:address, so the
     * bridge answers HTTP 400 { error: "Path GET /utxo/... is not allowed via /node-proxy" }.
     * The app must surface this honestly instead of inventing a balance.
     */
    @Test
    fun `balance with not-whitelisted rejection is unavailable with contract-gap reason`() {
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

    /** Real shape from get_address_txs (handlers.rs): { address, total, limit, offset, transactions }.
     *  Today this path is not in the server whitelist; when it is added, entries appear
     *  only from the node — this test pins the parser to the real field names. */
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
                  { "tx_hash": "2222", "from_address": "HSMCaa", "to_address": "HSMCbb", "confirmed": false, "location": "mempool" }
                ]
              }
            }
            """.trimIndent()
        )
        val result = parseAddressTxsResult(body)
        assertTrue(result.available)
        assertEquals(2, result.total)
        assertEquals(2, result.transactions.size)
        assertEquals("1111", result.transactions[0].txHash)
        assertTrue(result.transactions[0].confirmed)
        assertEquals(42L, result.transactions[0].blockNumber)
        assertEquals("beef", result.transactions[0].blockHash)
        assertFalse(result.transactions[1].confirmed)
    }

    @Test
    fun `address txs offline is unavailable`() {
        val body = JSONObject("""{ "ok": false, "node_online": false, "error": "HSMC node not connected" }""".trimIndent())
        val result = parseAddressTxsResult(body)
        assertFalse(result.available)
        assertTrue(result.transactions.isEmpty())
        assertTrue(result.reason!!.contains("node offline"))
    }

    @Test
    fun `address txs not-whitelisted is unavailable with contract-gap reason`() {
        val body = JSONObject("""{ "error": "Path GET /address/HSMCaa/txs is not allowed via /node-proxy" }""".trimIndent())
        val result = parseAddressTxsResult(body)
        assertFalse(result.available)
        assertTrue(result.reason!!.contains("node offline"))
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
