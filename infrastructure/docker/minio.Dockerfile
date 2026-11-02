# Build the pinned upstream security release instead of relying on retired public image tags.
FROM golang:1.24-bookworm AS build
ARG GO_SUMDB="sum.golang.org"
ENV CGO_ENABLED=0 GOMAXPROCS=4 GOFLAGS=-p=4 GOSUMDB=${GO_SUMDB}
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* && useradd --uid 1000 --create-home minio && mkdir /data && chown minio:minio /data
COPY --from=build /go/bin/minio /usr/local/bin/minio
USER minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
