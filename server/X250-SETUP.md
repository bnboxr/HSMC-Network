# HSMC Node — Configurație completă pentru Lenovo X250 / 4GB RAM / Linux

## Pasul 1: Instalează Linux (dacă n-ai deja)

**Recomand: Ubuntu Server 22.04 LTS (minimal)** — consumă doar ~400MB RAM idle.

Descarcă ISO de pe https://ubuntu.com/download/server
Scrie pe stick USB cu Rufus (Windows) sau `dd` (Linux).
La instalare, alege "Minimized" — fără desktop environment.

După instalare:
```bash
sudo apt update && sudo apt upgrade -y
```

---

## Pasul 2: Swap — crucial pentru 4GB

Fără swap, Rust o să dea OOM (out of memory) la compilare.

```bash
# 8GB swap (poți pune mai mult)
sudo fallocate -l 8G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Pasul 3: Instalează uneltele de bază

```bash
sudo apt install -y curl git build-essential pkg-config libssl-dev cmake clang
```

---

## Pasul 4: Instalează Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

---

## Pasul 5: Instalează Docker (opțional, mai simplu)

Dacă nu vrei Rust direct, Docker e alternativa:
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Re-login
```

---

## Pasul 6: Clonează repo-ul

```bash
git clone https://github.com/bnboxr/HSMC-Network.git
cd HSMC-Network/rust-node
```

---

## Pasul 7: Compilează cu limitări de RAM

```bash
# IMPORTANT: Limitează job-urile de compilare la 1 sau 2
# Altfel 4GB + swap = blocaj
export CARGO_BUILD_JOBS=1

# Release cu optimizări minime (mai rapid, consumă mai puțin RAM)
cargo build --release
```

Dacă dă OOM (out of memory), folosește debug build:
```bash
cargo build  # fără --release, consumă mult mai puțin RAM
```

---

## Pasul 8: Configurație HSMC pentru 4GB

Creează `config.toml`:
```bash
cat > config.toml << 'EOF'
# HSMC Node — X250 / 4GB RAM Optimized

[node]
name = "hsmc-x250"
listen_addr = "0.0.0.0"
p2p_port = 9733
rpc_port = 8080
stratum_port = 3333

[storage]
# RocksDB cu limitări stricte
db_path = "./data/blockchain"
max_open_files = 128        # default e 1000+, prea mult
write_buffer_mb = 32        # default 64-128
max_total_wal_size_mb = 32
block_cache_mb = 64         # critic: doar 64MB cache
cache_index_and_filter_blocks = false

[p2p]
max_peers = 20              # nu 100+
outbound_peers = 8
seed_nodes = []             # primul nod, lasă gol

[mining]
enabled = true
threads = 1                 # doar 1 thread mining
max_memory_mb = 128

[rpc]
max_request_body_mb = 2
rate_limit_rps = 30

[logging]
level = "warn"              # nu debug/info — salvezi CPU
EOF
```

---

## Pasul 9: Pornește nodul

```bash
# Din folderul rust-node/
./target/release/hsmc-node --config config.toml
```

---

## Pasul 10: Systemd (auto-start la boot)

```bash
sudo cat > /etc/systemd/system/hsmc-node.service << 'EOF'
[Unit]
Description=HSMC Blockchain Node
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/HSMC-Network/rust-node
ExecStart=/home/YOUR_USERNAME/HSMC-Network/rust-node/target/release/hsmc-node --config config.toml
Restart=on-failure
RestartSec=10
LimitNOFILE=4096
MemoryMax=2G
MemoryHigh=1.5G

[Install]
WantedBy=multi-user.target
EOF

# Înlocuiește YOUR_USERNAME cu username-ul tău!
sudo systemctl daemon-reload
sudo systemctl enable hsmc-node
sudo systemctl start hsmc-node
```

---

## Verificare

```bash
# Vezi dacă rulează
sudo systemctl status hsmc-node

# Vezi log-urile
journalctl -u hsmc-node -f

# Testează RPC
curl http://localhost:8080/health

# Vezi consumul RAM
htop
```

---

## Consum estimat pe 4GB

| Proces | RAM |
|--------|-----|
| OS (Ubuntu Server) | ~400 MB |
| HSMC Node + RocksDB | ~1.5 GB |
| Liber pentru mining | ~1 GB |
| Swap disponibil | 8 GB |

Dacă mai pui și frontend + API + mining server, mai ai nevoie de ~500MB. Total ~2.5GB din 4GB — e strâns dar merge.
