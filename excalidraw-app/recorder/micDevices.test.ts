import { getSavedMic, listMics, openMicStream, saveMic } from "./micDevices";

const setDevices = (api: Partial<MediaDevices>) => {
  Object.defineProperty(navigator, "mediaDevices", {
    value: api,
    configurable: true,
  });
};

describe("micDevices", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("remembers the chosen microphone and forgets it when cleared", () => {
    expect(getSavedMic()).toBe("");
    saveMic("abc");
    expect(getSavedMic()).toBe("abc");
    saveMic("");
    expect(getSavedMic()).toBe("");
  });

  it("lists only inputs, skips the default aliases and numbers unnamed ones", async () => {
    setDevices({
      enumerateDevices: async () =>
        [
          { kind: "audioinput", deviceId: "default", label: "Default" },
          { kind: "audioinput", deviceId: "communications", label: "Comms" },
          { kind: "audioinput", deviceId: "a", label: "USB mic" },
          { kind: "audioinput", deviceId: "b", label: "" },
          { kind: "audiooutput", deviceId: "c", label: "Speakers" },
          { kind: "videoinput", deviceId: "d", label: "Camera" },
        ] as MediaDeviceInfo[],
    });
    expect(await listMics()).toEqual([
      { id: "a", label: "USB mic" },
      { id: "b", label: "Microphone 2" },
    ]);
  });

  it("asks for exactly the chosen device", async () => {
    const getUserMedia = vi.fn(
      async (_c: MediaStreamConstraints) => ({} as MediaStream),
    );
    setDevices({ getUserMedia });
    await openMicStream("a");
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({
      audio: { deviceId: { exact: "a" } },
    });
  });

  it("falls back to the default microphone when the chosen one is gone", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("gone"), { name: "OverconstrainedError" }),
      )
      .mockResolvedValueOnce({} as MediaStream);
    setDevices({ getUserMedia });
    await openMicStream("a");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(
      (getUserMedia.mock.calls[1][0] as MediaStreamConstraints).audio,
    ).not.toHaveProperty("deviceId");
  });

  it("does not hide a permission error behind the fallback", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("no"), { name: "NotAllowedError" }),
      );
    setDevices({ getUserMedia });
    await expect(openMicStream("a")).rejects.toThrow("no");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
