// The recorder asks the desktop app to share a screen: the app must answer with its own page and nothing else.
import { describe, expect, it } from "vitest";

// @ts-expect-error a CommonJS module without types
import { chooseDisplayMedia } from "../desktop/capture.cjs";

const OURS = "http://127.0.0.1:3000";
const isOurs = (origin: string) => origin === OURS;
const frame = { processId: 1, routingId: 2 };

describe("sharing a screen in the desktop app", () => {
  it("hands over the page that asked, as the tab of the app", () => {
    expect(chooseDisplayMedia({ securityOrigin: OURS, frame }, isOurs)).toEqual(
      { video: frame },
    );
  });

  it("offers nothing to another origin, nor without a frame", () => {
    expect(
      chooseDisplayMedia(
        { securityOrigin: "https://example.com", frame },
        isOurs,
      ),
    ).toEqual({});
    expect(chooseDisplayMedia({ securityOrigin: OURS }, isOurs)).toEqual({});
    expect(chooseDisplayMedia(undefined, isOurs)).toEqual({});
  });
});
