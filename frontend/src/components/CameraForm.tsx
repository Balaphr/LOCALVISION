import { useState } from "react";
import type { Camera, CameraInput } from "../types/camera";

const empty: CameraInput = {
  name: "",
  location: "",
  manufacturer: "Generic IP Camera",
  model: "",
  host: "",
  port: 554,
  protocol: "RTSP",
  rtsp_url: "",
  onvif_url: "",
  username: "",
  password: "",
  main_stream: "",
  sub_stream: "",
  enabled: true,
  recording_enabled: true,
  ai_enabled: true
};

interface Props {
  camera?: Camera | null;
  onSave: (input: CameraInput) => Promise<void>;
  onCancel: () => void;
}

export function CameraForm({ camera, onSave, onCancel }: Props) {
  const [form, setForm] = useState<CameraInput>(() => camera ? { ...camera, password: "" } : empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key: keyof CameraInput, value: string) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const host = form.host.trim();
    const stream = (form.rtsp_url ?? "").trim();
    if (!host) {
      setError("RTSP IP / host is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...empty,
        name: `Camera ${host}`,
        host,
        port: 554,
        protocol: "RTSP",
        rtsp_url: stream,
        main_stream: stream,
        username: form.username ?? "",
        password: form.password ?? ""
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save camera");
    } finally {
      setSaving(false);
    }
  };

  return <form className="camera-form" onSubmit={submit}>
    <div className="form-heading">
      <div><span className="eyebrow">Camera manager</span><h2>{camera ? "Edit camera" : "Add a camera"}</h2></div>
      <button type="button" className="close-button" onClick={onCancel} aria-label="Close">×</button>
    </div>
    <p className="api-import-help">Enter the camera IP and its RTSP main stream URL. Cloudflare stores these details; live video requires a local bridge or tunnel.</p>
    {error && <div className="error-state" role="alert">{error}</div>}
    <div className="form-grid">
      <label>RTSP IP / Host<input required value={form.host} placeholder="192.168.1.3" onChange={event => update("host", event.target.value)} /></label>
      <label>Username<input value={form.username ?? ""} placeholder="adminuser" onChange={event => update("username", event.target.value)} /></label>
      <label>Password<input type="password" value={form.password ?? ""} placeholder={camera ? "Leave blank to keep current" : "Camera password"} onChange={event => update("password", event.target.value)} /></label>
      <label>RTSP main stream URL<input required value={form.rtsp_url ?? ""} placeholder="rtsp://192.168.1.3:554/stream1" onChange={event => update("rtsp_url", event.target.value)} /></label>
    </div>
    <div className="form-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save camera"}</button></div>
  </form>;
}
