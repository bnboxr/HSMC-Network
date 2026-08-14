# HSMC Public Mainnet — VPS Bootstrap (5+ nodes)

> ⚠️ **STATUS: NOT LIVE.** HSMC mainnet has **no deployed seed nodes** and no
> published seed addresses. Everything below is *launch preparation* — it
> provisions a node, but there is nothing public to connect to yet. Any
> placeholder seed entries you find (e.g. in `rust-node/config/genesis.toml`)
> are **documentation only** and must never be advertised as live seeds.

This script provisions a fresh Ubuntu 22.04 VPS as a public seed node:
RPC on :8080, P2P on :30303, Stratum on :3333, Cloudflare Tunnel for
HTTPS, systemd auto-restart, log rotation.

## Run on each VPS (recommended: 4 vCPU, 8 GB RAM, 200 GB SSD)

```bash
# As root, on a fresh Ubuntu 22.04
curl -fsSL https://raw.githubusercontent.com/bnboxr/HSMC-Network/main/rust-node/seed-bootstrap.sh | sudo bash
```

The script:
1. Installs Rust, clang, RocksDB deps, Cloudflare CLI.
2. Clones the repo, builds `hsmc-node --release`.
3. Generates a unique node identity (saved to `/var/hsmc/identity.key`).
4. Configures systemd: `systemctl status hsmc-node`.
5. Registers in the public seed list — **planned, not yet implemented**: the
   bootstrap script currently stops after provisioning; seed-list publishing
   and gossip to other seeds do not exist in code yet.
6. Optionally starts a Cloudflare Tunnel for `https://node-<region>.hsmc.network`.

## Run 5 of these in different regions

| Region          | Provider example | Cost (USD/mo) |
| --------------- | ---------------- | ------------- |
| Frankfurt (EU)  | Hetzner CX42     | ~25           |
| Amsterdam (EU)  | TransIP S6       | ~30           |
| New York (US-E) | Vultr Cloud Compute | ~24        |
| Singapore (APAC)| OVH Public Cloud | ~28           |
| São Paulo (LATAM)| DigitalOcean    | ~32           |

Total: ~$140/month for a 5-node geographically distributed mainnet.

## Genesis block — source of truth

The genesis block is **hardcoded in the node**, not read from any file:

- **Genesis block:** `rust-node/hsmc-core/src/block.rs::genesis_block()` —
  fixed timestamp `1_700_000_000`, nonce `2083236893`, miner
  `HSMC_GENESIS_…`, reward `INITIAL_REWARD` (50.0), difficulty `MIN_DIFFICULTY`
  (256), coinbase message ending in `8888`.
- **Chain ID:** numeric `8888`. Defined in:
  - `rust-node/hsmc-node/src/main.rs` — `NodeConfig::from_env()`, override via
    `CHAIN_ID` env var (default `8888`);
  - `rust-node/hsmc-core/src/chain.rs` — `Chain::new()` (`chain_id: 8888`);
  - `rust-node/hsmc-rpc/src/server.rs` and `hsmc-rpc/src/handlers.rs` — the
    `/health` endpoint reports `"chain_id": 8888`, `"network": "mainnet"`.
- First node to start mints block 0 from `genesis_block()`; subsequent nodes
  sync from it.

> ⚠️ **`rust-node/config/genesis.toml` is NON-AUTHORITATIVE.** It is
> *aspirational documentation* of the intended mainnet parameters. Nothing in
> the code reads it — there is no `HSMC_GENESIS_CONFIG` reader or TOML genesis
> parser — so changing it has **no effect** on the running node. Its
> `chain_id = "hsmc-mainnet-1"` (a string) intentionally differs from the
> hardcoded numeric `8888`; that mismatch is known and expected. Before
> mainnet, either wire `genesis.toml` into `NodeConfig` or delete it.

### Chain-identity verification

Run `rust-node/config/verify-chain-identity.sh` (POSIX sh, no build required)
to print the actual chain identity the node will use, the `genesis.toml`
values, and the known mismatch. Do not trust a node that reports a chain ID
other than `8888`, and do not accept any seed address from
`genesis.toml`/docs as live — there are no live seeds until announced
elsewhere.

To launch mainnet officially:
1. Tag a release: `git tag v1.0.0 && git push --tags`
2. CI builds & uploads `hsmc-node` binary as a release asset.
3. Each seed VPS pulls the tagged binary via the bootstrap script.
4. Announce mainnet open at https://hsmc.network/launch with seed IPs.
