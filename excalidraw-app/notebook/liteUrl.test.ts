import { jupyterLiteUrl } from "./liteUrl";

describe("jupyterLiteUrl", () => {
  const here = { protocol: "http:", hostname: "127.0.0.1" };

  it("defaults to port 3002 on the host the app is served from", () => {
    expect(jupyterLiteUrl(here, undefined)).toBe(
      "http://127.0.0.1:3002/lab/index.html",
    );
    expect(
      jupyterLiteUrl({ protocol: "https:", hostname: "trazo.lan" }, ""),
    ).toBe("https://trazo.lan:3002/lab/index.html");
  });

  it("uses the configured origin, without a trailing slash", () => {
    expect(jupyterLiteUrl(here, " https://notebooks.example.com/ ")).toBe(
      "https://notebooks.example.com/lab/index.html",
    );
  });
});
