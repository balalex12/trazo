# Security policy

The full model — what stays local, what can leave your machine, hardening, and how to verify it — is in [docs/SECURITY.md](docs/SECURITY.md).

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting (repository → _Security_ → _Report a vulnerability_). Include steps to reproduce, affected version/commit and impact. You will get an acknowledgement and a fix or mitigation plan; credit is given unless you prefer otherwise.

## Scope

In scope: this repository's code (viewer, animation, LLM connector, build/deploy configuration), the Docker setup and the CSP. Out of scope: vulnerabilities that exist unchanged in upstream Excalidraw (report them upstream), in Esri software/services, or in the LLM provider you connect.

## Supported versions

Only the latest release/`main`.
