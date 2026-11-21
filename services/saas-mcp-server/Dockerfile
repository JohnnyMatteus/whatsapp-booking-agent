# syntax=docker/dockerfile:1.7
FROM golang:1.26.0-alpine3.22 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/saas-mcp-server ./cmd/saas-mcp-server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/saas-mcp-server /saas-mcp-server
USER nonroot:nonroot
EXPOSE 8090
ENTRYPOINT ["/saas-mcp-server"]
