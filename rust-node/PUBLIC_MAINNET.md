# HSMC Public Mainnet — VPS Bootstrap (5+ nodes)

This script provisions a fresh Ubuntu 22.04 VPS as a public seed node:
RPC on :8080, P2P on :30303, Stratum on :3333, Cloudflare Tunnel for
HTTPS, systemd auto-restart, log rotation.

## Run on each VPS (recommended: 4 vCPU, 8 GB RAM, 200 GB SSD)

```bash
# As root, on a fresh Ubuntu 22.04
curl -fsSL https://raw.githubusercontent.com/XMC-OXR/astranet-network-hub/main/rust-node/seed-bootstrap.sh | sudo bash
```

The script:
1. Installs Rust, clang, RocksDB deps, Cloudflare CLI.
2. Clones the repo, builds `hsmc-node --release`.
3. Generates a unique node identity (saved to `/var/hsmc/identity.key`).
4. Configures systemd: `systemctl status hsmc-node`.
5. Joins the public seed list (gossips peer info to other seeds).
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

## Genesis block

The genesis block is committed in `rust-node/hsmc-core/src/chain.rs::GENESIS_BLOCK`.
First seed to start mints block 0; subsequent seeds sync from it.

To launch mainnet officially:
1. Tag a release: `git tag v1.0.0 && git push --tags`
2. CI builds & uploads `hsmc-node` binary as a release asset.
3. Each seed VPS pulls the tagged binary via the bootstrap script.
4. Announce mainnet open at https://hsmc.network/launch with seed IPs.
