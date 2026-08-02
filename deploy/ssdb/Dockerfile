FROM debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818 AS builder

ARG SSDB_REPOSITORY=https://github.com/ideawu/ssdb.git
ARG SSDB_COMMIT=3e556e4bf4cee96d2577e3c3002f00c540e4ba10

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        autoconf \
        ca-certificates \
        g++ \
        gcc \
        git \
        make \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --no-checkout "${SSDB_REPOSITORY}" /src/ssdb \
    && cd /src/ssdb \
    && git checkout --detach "${SSDB_COMMIT}" \
    && test "$(git rev-parse HEAD)" = "${SSDB_COMMIT}"

WORKDIR /src/ssdb
RUN make -j"$(nproc)"

FROM debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818

LABEL org.opencontainers.image.source="https://github.com/ideawu/ssdb" \
      org.opencontainers.image.version="1.9.9" \
      org.opencontainers.image.revision="3e556e4bf4cee96d2577e3c3002f00c540e4ba10" \
      org.opencontainers.image.description="Locally built SSDB cache image for infinite-canvas development"

RUN mkdir -p /etc/ssdb /var/lib/ssdb \
    && chown -R 65532:65532 /var/lib/ssdb

COPY --from=builder /src/ssdb/ssdb-server /usr/local/bin/ssdb-server
COPY ssdb.conf /etc/ssdb/ssdb.conf

USER 65532:65532
EXPOSE 8888
VOLUME ["/var/lib/ssdb"]
ENTRYPOINT ["/usr/local/bin/ssdb-server", "/etc/ssdb/ssdb.conf"]
