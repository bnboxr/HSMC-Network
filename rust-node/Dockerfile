# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM rust:1.78-bookworm AS builder

# System deps for RocksDB
RUN apt-get update && apt-get install -y \
    clang \
    libclang-dev \
    libssl-dev \
    pkg-config \
    cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy workspace manifests first for layer caching
COPY Cargo.toml Cargo.lock ./
COPY hsmc-core/Cargo.toml        hsmc-core/Cargo.toml
COPY hsmc-crypto/Cargo.toml      hsmc-crypto/Cargo.toml
COPY hsmc-p2p/Cargo.toml         hsmc-p2p/Cargo.toml
COPY hsmc-rpc/Cargo.toml         hsmc-rpc/Cargo.toml
COPY hsmc-storage/Cargo.toml     hsmc-storage/Cargo.toml
COPY hsmc-stratum/Cargo.toml     hsmc-stratum/Cargo.toml
COPY hsmc-node/Cargo.toml        hsmc-node/Cargo.toml

# Placeholder src files so cargo can fetch deps without real source
RUN mkdir -p hsmc-core/src       && echo "pub fn _dummy() {}" > hsmc-core/src/lib.rs
RUN mkdir -p hsmc-crypto/src     && echo "pub fn _dummy() {}" > hsmc-crypto/src/lib.rs
RUN mkdir -p hsmc-p2p/src        && echo "pub fn _dummy() {}" > hsmc-p2p/src/lib.rs
RUN mkdir -p hsmc-rpc/src        && echo "pub fn _dummy() {}" > hsmc-rpc/src/lib.rs
RUN mkdir -p hsmc-storage/src    && echo "pub fn _dummy() {}" > hsmc-storage/src/lib.rs
RUN mkdir -p hsmc-stratum/src    && echo "pub fn _dummy() {}" > hsmc-stratum/src/lib.rs
RUN mkdir -p hsmc-node/src       && echo "fn main() {}" > hsmc-node/src/main.rs
RUN cargo build --release 2>/dev/null || true

# Now copy real source and build properly
COPY . .
RUN touch hsmc-node/src/main.rs
RUN cargo build --release --bin hsmc-node

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 1000 hsmc
USER hsmc
WORKDIR /home/hsmc

# Copy binary
COPY --from=builder /build/target/release/hsmc-node /usr/local/bin/hsmc-node

# Persistent data volume
VOLUME ["/home/hsmc/hsmc-data"]

# Ports: 8080 (RPC), 3333 (Stratum), 9090 (Metrics)
EXPOSE 8080 3333 9090

ENV HSMC_DATA_DIR=/home/hsmc/hsmc-data
ENV RPC_PORT=8080
ENV STRATUM_PORT=3333
ENV RUST_LOG=info

CMD ["hsmc-node"]
EXPOSE 9090
