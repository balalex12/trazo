import { useCallback, useEffect, useState } from "react";

import { getSavedMic, listMics, saveMic } from "../recorder/micDevices";

import type { MicDevice } from "../recorder/micDevices";

/** the microphone list, kept up to date when a device is plugged in or removed */
export const useMics = () => {
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [deviceId, setDeviceId] = useState(getSavedMic);

  const refresh = useCallback(() => {
    listMics()
      .then(setMics)
      .catch(() => setMics([]));
  }, []);

  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.("devicechange", refresh);
    return () => md?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  const choose = (id: string) => {
    setDeviceId(id);
    saveMic(id);
  };

  return { mics, deviceId, choose, refresh };
};

/** a drop-down with the microphones; empty value means the system default */
export const MicSelect = ({
  mics,
  deviceId,
  onChange,
  style,
}: {
  mics: MicDevice[];
  deviceId: string;
  onChange: (id: string) => void;
  style?: React.CSSProperties;
}) => (
  <select
    style={style}
    value={mics.some((m) => m.id === deviceId) ? deviceId : ""}
    title="Microphone"
    onChange={(e) => onChange(e.target.value)}
  >
    <option value="">System default microphone</option>
    {mics.map((m) => (
      <option key={m.id} value={m.id}>
        {m.label}
      </option>
    ))}
  </select>
);
