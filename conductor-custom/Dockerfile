FROM conductoross/conductor-standalone:3.15.0

# Install curl for health checks (Alpine-based)
RUN apk add --no-cache curl

# The base image already has Conductor with all dependencies
# We just need to configure it via environment variables in docker-compose.yaml

EXPOSE 8080 5000
