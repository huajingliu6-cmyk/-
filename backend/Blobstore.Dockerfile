FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags='-s -w' -o /out/infinite-canvas-blobstore ./cmd/blobstore

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/infinite-canvas-blobstore /infinite-canvas-blobstore
EXPOSE 8090
ENTRYPOINT ["/infinite-canvas-blobstore"]
