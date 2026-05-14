# syntax=docker/dockerfile:1.6
#
# Build context is the repo ROOT (see docker-compose.yml). All COPY paths are
# rooted at the repo, not the backend/ subdir. The image bundles three runtime
# pieces the issuer-service /prove/groth16 endpoint needs:
#   1. The three service binaries (api-gateway, issuer-service, indexer)
#   2. The Sunspot Go CLI, built from source at the same rev pinned by the
#      gnark-verifier-solana Cargo dep in backend/programs/zksettle/Cargo.toml
#   3. The pre-built circuit artefacts (ACIR JSON, gnark CCS, Groth16 PK).
#      These are produced by `nargo compile` + `sunspot setup` and committed
#      under circuits/target/. Regenerating them requires updating
#      DEFAULT_ACIR_SHA256 in backend/crates/issuer-service/src/config.rs.

FROM golang:1.24-bookworm AS sunspot-builder
WORKDIR /src
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/reilabs/sunspot.git . \
 && git checkout ce4765ccdf050507874bbb544be992a11dc48ffc \
 && cd go && go build -o /out/sunspot .

FROM rust:1.82-slim AS builder
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends clang libclang-dev libssl-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*
COPY backend/Cargo.toml backend/Cargo.lock backend/rust-toolchain.toml ./
COPY backend/programs/ programs/
COPY backend/crates/ crates/
RUN cargo build --release --locked -p api-gateway -p issuer-service -p indexer

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -r -s /usr/sbin/nologin appuser
COPY --from=builder /app/target/release/api-gateway /usr/local/bin/
COPY --from=builder /app/target/release/issuer-service /usr/local/bin/
COPY --from=builder /app/target/release/indexer /usr/local/bin/
COPY --from=sunspot-builder /out/sunspot /usr/local/bin/sunspot
COPY circuits/target/zksettle_slice.json /artefacts/zksettle_slice.json
COPY circuits/target/zksettle_slice.ccs  /artefacts/zksettle_slice.ccs
COPY circuits/target/zksettle_slice.pk   /artefacts/zksettle_slice.pk
RUN chown -R appuser:appuser /artefacts
USER appuser
CMD ["sh", "-c", "exec ${SERVICE:-api-gateway}"]
