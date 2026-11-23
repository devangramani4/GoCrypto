#!/usr/bin/env bash
# Builds and runs the GoCrypto sandbox demo inside a GitHub Codespace (see devcontainer.json).
#   demo.sh build   build the image from this checkout (when the codespace is created, ~10 minutes)
#   demo.sh start   (re)start the demo with a fresh database and print the address to share
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# Docker-in-Docker starts together with the codespace.
for _ in $(seq 1 120); do docker info > /dev/null 2>&1 && break; sleep 1; done

build() {
  docker build -t gocrypto-demo -f infrastructure/demo/Dockerfile --build-arg GOCRYPTO_SOURCE=local .
}

case "${1:-start}" in
  build)
    build
    ;;
  start)
    docker image inspect gocrypto-demo > /dev/null 2>&1 || build
    if [ -n "${CODESPACE_NAME:-}" ]; then
      url="https://${CODESPACE_NAME}-7860.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
    else
      url="http://localhost:7860"
    fi
    docker rm -f gocrypto-demo > /dev/null 2>&1 || true
    docker run -d --name gocrypto-demo -p 7860:7860 -e PUBLIC_URL="$url" gocrypto-demo > /dev/null
    # Codespaces ports are private by default; a public port can be opened by anyone with the link.
    if ! gh codespace ports visibility 7860:public -c "${CODESPACE_NAME:-}" > /dev/null 2>&1; then
      echo "To share the demo, set port 7860 to Public in the PORTS tab."
    fi
    echo "GoCrypto demo starting at $url (ready in about a minute)"
    ;;
  *)
    echo "usage: demo.sh build|start" >&2
    exit 2
    ;;
esac
