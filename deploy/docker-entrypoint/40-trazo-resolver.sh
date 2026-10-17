#!/bin/sh
# nginx resolves ollama.com per request (the "Ollama Cloud" route of app.conf) and needs the address of a DNS server for it.
# On a Compose network that is Docker's own (127.0.0.11); on the default network of `docker run` it is the one in
# /etc/resolv.conf. The filesystem is read-only, so the line is written to /tmp.
set -eu
ns=$(awk '/^nameserver/ { print $2 }' /etc/resolv.conf | grep -v ':' | head -3 | tr '\n' ' ' || true)
echo "resolver ${ns:-127.0.0.11} valid=30s ipv6=off;" > /tmp/trazo-resolver.conf
