FROM rust:1.82-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends clang libclang-dev libssl-dev pkg-config && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY programs/ programs/
COPY crates/ crates/
RUN cargo build --release --locked -p api-gateway -p issuer-service -p indexer

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -r -s /usr/sbin/nologin appuser
COPY --from=builder /app/target/release/api-gateway /usr/local/bin/
COPY --from=builder /app/target/release/issuer-service /usr/local/bin/
COPY --from=builder /app/target/release/indexer /usr/local/bin/
USER appuser
CMD ["sh", "-c", "exec ${SERVICE:-api-gateway}"]
