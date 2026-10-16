import { describe, expect, it } from "vitest";

import { parseCompose } from "./compose";
import { loadYaml } from "./yaml";

const bomb = (depth: number) => {
  const lines = ['x-a0: &a0 ["x","x","x","x","x","x","x","x","x"]'];
  for (let i = 1; i <= depth; i++) {
    lines.push(
      `x-a${i}: &a${i} [${Array(9)
        .fill(`*a${i - 1}`)
        .join(",")}]`,
    );
  }
  return `${lines.join(
    "\n",
  )}\nservices:\n  web:\n    image: nginx\n    depends_on: *a${depth}\n`;
};

describe("yaml alias budget", () => {
  it("refuses a file that expands through nested aliases, quickly", () => {
    const t = Date.now();
    expect(() => parseCompose(bomb(10))).toThrow(/too many values/);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("accepts ordinary anchors and merge keys", () => {
    const text = `
x-common: &common
  restart: unless-stopped
  environment: [A=1, B=2]
services:
  web:
    <<: *common
    image: nginx
  api:
    <<: *common
    image: node
    depends_on: [web]
`;
    expect(parseCompose(text).services.map((s) => s.name)).toEqual([
      "web",
      "api",
    ]);
    expect(loadYaml("a: [1, 2, 3]")).toEqual({ a: [1, 2, 3] });
  });
});
