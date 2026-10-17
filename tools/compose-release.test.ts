// The compose file of a release (deploy/docker-compose.release.yml, from the published images) must be the same product
// and the same hardening as the repository's docker-compose.yml, which builds it: same services, same ports, same limits.
import { readFileSync } from "node:fs";
import path from "node:path";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  load(readFileSync(path.resolve(__dirname, "..", file), "utf8")) as {
    services: Record<string, Record<string, unknown>>;
  };

const HARDENING = [
  "container_name",
  "ports",
  "read_only",
  "tmpfs",
  "cap_drop",
  "cap_add",
  "security_opt",
  "restart",
];

describe("docker compose files", () => {
  const repo = read("docker-compose.yml");
  const release = read("deploy/docker-compose.release.yml");

  it("run the same service: one image with the app, the viewer and the notebooks", () => {
    expect(Object.keys(release.services)).toEqual(["trazo"]);
    expect(repo.services.trazo).toBeDefined();
    expect(release.services.trazo.ports).toEqual([
      "127.0.0.1:3000:3000",
      "127.0.0.1:3001:3001",
      "127.0.0.1:3002:3002",
    ]);
  });

  it("have the same ports and hardening for every service", () => {
    for (const name of Object.keys(release.services)) {
      for (const key of HARDENING) {
        expect(release.services[name][key], `${name}.${key}`).toEqual(
          repo.services[name][key],
        );
      }
    }
  });

  it("start the published image of the version", () => {
    expect(release.services.trazo.image).toBe(
      "ghcr.io/balalex12/trazo:__VERSION__",
    );
  });
});
