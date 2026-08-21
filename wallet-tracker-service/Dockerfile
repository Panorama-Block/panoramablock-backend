FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum first to leverage Docker cache
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o wallet-tracker-service ./cmd/main.go

# Use a smaller image for the final container
FROM alpine:latest

WORKDIR /app

# Copy binary from builder stage
COPY --from=builder /app/wallet-tracker-service .

# Expose port
EXPOSE 3000

# Run the binary
CMD ["./wallet-tracker-service"]
