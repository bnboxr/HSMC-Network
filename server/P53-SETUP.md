# HSMC Node — Configurație completă pentru Lenovo P53 Workstation / Linux

## Specificații tipice P53
- CPU: Intel i7/i9 9th gen (6-8 core, 12-16 threads)
- RAM: 32-64GB DDR4
- Storage: SSD NVMe 512GB-1TB
- GPU: Quadro T1000/T2000 (opțional pentru mining)

---

## Pasul 1: Instalează Linux

**Recomand: Ubuntu Server 22.04 LTS**

https://ubuntu.com/download/server

La instalare: partiții separate pentru `/` (100GB) și `/data` (restul — pentru blockchain).

---

## Pasul 2: Swap — 16GB (chiar și pe 32GB RAM)

```bash
sudo fallocate -l 16G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Pasul 3: Unelte

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential pkg-config libssl-dev cmake clang \
  htop iotop net-tools ufw unzip jq
```

---

## Pasul 4: Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

---

## Pasul 5: Docker (opțional)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

---

## Pasul 6: Clonează + Compilează

```bash
git clone https://github.com/bnboxr/HSMC-Network.git
cd HSMC-Network/rust-node

# Pe P53 poți folosi toate core-urile
export CARGO_BUILD_JOBS=$(nproc)

cargo build --release
```

---

## Pasul 7: Configurație HSMC pentru P53

```bash
cat > config.toml << 'EOF'
# HSMC Node — P53 Workstation

[node]
name = "hsmc-p53"
listen_addr = "0.0.0.0"
p2p_port = 9733
rpc_port = 8080
stratum_port = 3333

[storage]
db_path = "/data/blockchain"    # SSD dedicat
max_open_files = 2000
write_buffer_mb = 128
max_total_wal_size_mb = 256
block_cache_mb = 512
cache_index_and_filter_blocks = true
compression = "lz4"

[p2p]
max_peers = 100
outbound_peers = 16
# Adaugă seed nodes când ai altele

[mining]
enabled = true
threads = 4                     # lași 2-4 core pentru restul
max_memory_mb = 1024

[rpc]
max_request_body_mb = 8
rate_limit_rps = 100

[logging]
level = "info"                  # poți vedea ce se întâmplă
EOF
```

---

## Pasul 8: Rulează TOT stack-ul

Pe P53 poți rula simultan: nodul Rust + API + frontend + mining + AI Co-Pilot.

```bash
# Terminal 1: Rust Node
cd ~/HSMC-Network/rust-node
./target/release/hsmc-node --config config.toml

# Terminal 2: API Server (Node.js sau Bun)
cd ~/HSMC-Network
bun run /home/team/shared/api-server.ts

# Terminal 3: Mining Stratum
bun run /home/team/shared/mining-server.ts

# Terminal 4: Frontend (dev)
cd ~/HSMC-Network
npm run dev

# Terminal 5: AI Co-Pilot
LOVABLE_API_KEY=sk-... bun run /home/team/shared/copilot-server.ts
```

---

## Pasul 9: Systemd — auto-start la boot

```bash
# Rust Node
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
LimitNOFILE=65536
MemoryMax=8G
MemoryHigh=6G

[Install]
WantedBy=multi-user.target
EOF

# API Server
sudo cat > /etc/systemd/system/hsmc-api.service << 'EOF'
[Unit]
Description=HSMC API Server
After=network.target hsmc-node.service
Requires=hsmc-node.service

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/HSMC-Network
ExecStart=/usr/local/bin/bun run /home/team/shared/api-server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Mining Server
sudo cat > /etc/systemd/system/hsmc-mining.service << 'EOF'
[Unit]
Description=HSMC Stratum Mining
After=network.target hsmc-node.service

[Service]
Type=simple
User=YOUR_USERNAME
ExecStart=/usr/local/bin/bun run /home/team/shared/mining-server.ts
Restart=on-failure
RestartSec=5
Environment=MINING_API_KEY=your-secret-key-here

[Install]
WantedBy=multi-user.target
EOF

# Activează tot
sudo systemctl daemon-reload
sudo systemctl enable hsmc-node hsmc-api hsmc-mining
sudo systemctl start hsmc-node hsmc-api hsmc-mining
```

---

## Pasul 10: Firewall

```bash
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 8080/tcp    # RPC
sudo ufw allow 9733/tcp    # P2P
sudo ufw allow 3333/tcp    # Stratum
sudo ufw allow 3000/tcp    # Frontend
sudo ufw enable
```

---

## Consum estimat P53

| Proces | RAM | CPU |
|--------|-----|-----|
| OS (Ubuntu Server) | ~400 MB | idle |
| Rust Node + RocksDB | ~6 GB | 2-4 core |
| Mining (4 threads) | ~1 GB | 4 core |
| API Server | ~200 MB | 1 core |
| Frontend (dev) | ~500 MB | 1 core |
| AI Co-Pilot | ~200 MB | idle |
| **TOTAL** | **~8.5 GB** | **6-8 core** |

Ai ~23GB+ liberi pe 32GB. Perfect pentru development + testnet + mining simultan.

---

## Tips P53

1. **SSD separat pentru blockchain** — `/data` pe partiție dedicată. RocksDB scrie mult.
2. **Răcire** — P53 are ventilatoare bune, dar mining-ul pe 4 thread-uri 24/7 o să le țină pornite.
3. **UPS** — dacă vrei uptime 24/7, pune-l pe UPS. Căderile de curent corup RocksDB.
4. **IP static** — configurează IP static sau DDNS (duckdns.org e gratis) ca să poți accesa nodul de oriunde.
