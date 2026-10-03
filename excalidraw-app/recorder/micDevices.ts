// Which microphone to use. The choice is remembered on this device and shared by the recorder and the narration.

const KEY = "trazo-mic-device";

export type MicDevice = { id: string; label: string };

export const getSavedMic = (): string => {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
};

export const saveMic = (id: string) => {
  try {
    if (id) {
      localStorage.setItem(KEY, id);
    } else {
      localStorage.removeItem(KEY);
    }
  } catch {
    // private window or blocked storage: the choice just is not remembered
  }
};

/**
 * Input devices as the browser lists them. Names stay empty until the microphone has been allowed once, so unnamed
 * devices get a number. The "default" and "communications" aliases repeat a real device and are dropped.
 */
export const listMics = async (): Promise<MicDevice[]> => {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  const inputs = all.filter(
    (d) =>
      d.kind === "audioinput" &&
      d.deviceId !== "default" &&
      d.deviceId !== "communications",
  );
  return inputs.map((d, i) => ({
    id: d.deviceId,
    label: d.label || `Microphone ${i + 1}`,
  }));
};

const AUDIO_PROCESSING = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * Opens the chosen microphone, or the system default when none is chosen or the chosen one is gone
 * (unplugged since last time).
 */
export const openMicStream = async (
  deviceId?: string,
): Promise<MediaStream> => {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, ...AUDIO_PROCESSING },
        video: false,
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name !== "OverconstrainedError" && name !== "NotFoundError") {
        throw e;
      }
    }
  }
  return navigator.mediaDevices.getUserMedia({
    audio: AUDIO_PROCESSING,
    video: false,
  });
};
