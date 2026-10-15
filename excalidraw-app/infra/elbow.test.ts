import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { describe, expect, it } from "vitest";

import { parseCompose } from "./compose";
import { layoutCompose, layoutToSkeleton } from "./layout";

const SAMPLE = `
services:
  web:
    image: nginx
    depends_on: [api, cache]
  api:
    image: app
    depends_on: [db, cache, queue]
  worker:
    image: app
    depends_on: [db, queue]
  db:
    image: postgres
  cache:
    image: redis
  queue:
    image: rabbitmq
`;

describe("elbow arrows once converted to editor elements", () => {
  it("keep every corner and stay bound to their two boxes", () => {
    const layout = layoutCompose(parseCompose(SAMPLE));
    const sk = layoutToSkeleton(layout);
    const els = convertToExcalidrawElements(sk as any);
    const arrows = els.filter((e) => e.type === "arrow") as any[];
    expect(arrows).toHaveLength(layout.edges.length);
    let withCorners = 0;
    for (const a of arrows) {
      expect(a.startBinding?.elementId).toBeTruthy();
      expect(a.endBinding?.elementId).toBeTruthy();
      if (a.points.length > 2) {
        withCorners++;
      }
      for (let i = 1; i < a.points.length; i++) {
        const dx = Math.abs(a.points[i][0] - a.points[i - 1][0]);
        const dy = Math.abs(a.points[i][1] - a.points[i - 1][1]);
        expect(Math.min(dx, dy)).toBeLessThan(1.01); // 0.5px nudge the converter applies at the ends
      }
    }
    expect(withCorners).toBeGreaterThan(0);
  });
});
