import { useState } from "react";
import type { Camera, CameraInput, Protocol } from "../types/camera";
import type { CameraTestResult, DiscoveryResult } from "../types/operations";
import { cameraApi } from "../services/api";

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
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<DiscoveryResult[]>([]);
  const [test, setTest] = useState<CameraTestResult | null>(null);

  const update = (key: keyof CameraInput, value: string | number | boolean) => {
    setForm(current => ({ ...current, [key]: value }));
    setTest(null);
  };

  const discover = async () => {
    setBusy("discover");
    setError("");
    try {
      const found = await cameraApi.discover();
      setDevices(found.filter(device => !device.error));
      if (!found.length) setError("No cameras were found. Enter the connection details manually.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Discovery failed");
    } finally {
      setBusy("");
    }
  };

  const applyDevice = (device: DiscoveryResult) => {
    setForm(current => ({
      ...current,
      host: device.ip,
      port: device.port || current.port,
      manufacturer: device.manufacturer || current.manufacturer,
      model: device.model || current.model,
      name: current.name || device.model || `Camera ${device.ip}`,
      protocol: "ONVIF",
      onvif_url: device.onvif_endpoint ?? current.onvif_url,
      rtsp_url: device.rtsp_url ?? current.rtsp_url,
      main_stream: device.rtsp_url ?? current.main_stream
    }));
    setStep(1);
    setTest(null);
  };

  const inspect = async () => {
    if (!form.onvif_url) {
      setError("Enter an ONVIF endpoint such as http://192.168.1.64/onvif/device_service.");
      return;
    }
    setBusy("inspect");
    setError("");
    try {
      const device = await cameraApi.inspectOnvif(form.onvif_url, form.username || undefined, form.password || undefined);
      if (device.error) throw new Error(device.error);
      applyDevice(device);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "ONVIF inspection failed");
    } finally {
      setBusy("");
    }
  };

  const verify = async () => {
    setBusy("test");
    setError("");
    setTest(null);
    try {
      const result = camera ? await cameraApi.test(camera.id) : await cameraApi.testDraft(form);
      setTest(result);
      if (result.status !== "reachable") setError(result.hints ?? result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection test failed");
    } finally {
      setBusy("");
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!test || test.status !== "reachable") {
      setError("Test the connection before saving.");
      setStep(2);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save camera");
    } finally {
      setSaving(false);
    }
  };

  return <form className="camera-form wizard" onSubmit={submit}>
    <div className="form-heading">
      <div><span className="eyebrow">{camera ? "Edit camera" : "Connection wizard"}</span><h2>{camera ? camera.name : "Add a camera"}</h2></div>
      <button type="button" className="close-button" onClick={onCancel} aria-label="Close">×</button>
    </div>
    <div className="wizard-steps">
      {["Discover", "Connect", "Verify"].map((label, index) => <button type="button" key={label} className={step === index ? "active" : ""} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}
    </div>
    {error && <div className="error-state" role="alert">{error}</div>}
    {step === 0 && <div className="wizard-panel">
      <p className="api-import-help">LocalVision can search your LAN for ONVIF cameras, or you can enter an ONVIF endpoint to resolve its stream URL automatically.</p>
      <button type="button" className="primary" disabled={busy === "discover"} onClick={discover}>{busy === "discover" ? "Scanning…" : "Scan network"}</button>
      <div className="discovery-list">
        {devices.map(device => <button type="button" className="discovery-item" key={`${device.ip}-${device.port}`} onClick={() => applyDevice(device)}>
          <b>{device.manufacturer || "ONVIF camera"} {device.model}</b>
          <small>{device.ip}:{device.port} · {device.rtsp_url ? "RTSP available" : device.onvif_endpoint ?? "ONVIF endpoint"}</small>
        </button>)}
        {!devices.length && <span className="empty-hint">No discovered devices yet.</span>}
      </div>
      <div className="form-actions"><button type="button" className="primary" onClick={() => setStep(1)}>Enter details manually →</button></div>
    </div>}
    {step === 1 && <div className="wizard-panel">
      <div className="form-grid">
        <label>Camera name<input required value={form.name} placeholder="Front entrance" onChange={event => update("name", event.target.value)} /></label>
        <label>Location<input value={form.location} placeholder="North gate" onChange={event => update("location", event.target.value)} /></label>
        <label>Protocol<select value={form.protocol} onChange={event => update("protocol", event.target.value as Protocol)}>{["RTSP", "ONVIF", "HTTP", "MJPEG", "Other"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Port<input type="number" min={1} max={65535} value={form.port} onChange={event => update("port", Number(event.target.value))} /></label>
        <label>IP / Host<input required value={form.host} placeholder="192.168.1.100" onChange={event => update("host", event.target.value)} /></label>
        <label>Username<input value={form.username ?? ""} placeholder="Optional" onChange={event => update("username", event.target.value)} /></label>
        <label>Password<input type="password" value={form.password ?? ""} placeholder={camera ? "Leave blank to keep current" : "Camera password"} onChange={event => update("password", event.target.value)} /></label>
        <label>Manufacturer<input value={form.manufacturer} onChange={event => update("manufacturer", event.target.value)} /></label>
        <label>Model<input value={form.model} onChange={event => update("model", event.target.value)} /></label>
        <label>RTSP / main stream URL<input value={form.rtsp_url ?? ""} placeholder="rtsp://host:554/stream" onChange={event => update("rtsp_url", event.target.value)} /></label>
        <label>ONVIF endpoint<input value={form.onvif_url ?? ""} placeholder="http://host/onvif/device_service" onChange={event => update("onvif_url", event.target.value)} /></label>
        <label>Sub stream (optional)<input value={form.sub_stream ?? ""} placeholder="Lower-resolution stream" onChange={event => update("sub_stream", event.target.value)} /></label>
      </div>
      {form.protocol === "ONVIF" && <button type="button" disabled={busy === "inspect"} onClick={inspect}>{busy === "inspect" ? "Inspecting…" : "Inspect ONVIF profile"}</button>}
      <div className="toggle-row">
        <label><input type="checkbox" checked={form.enabled} onChange={event => update("enabled", event.target.checked)} /> Enabled</label>
        <label><input type="checkbox" checked={form.recording_enabled} onChange={event => update("recording_enabled", event.target.checked)} /> Event clips</label>
        <label><input type="checkbox" checked={form.ai_enabled} onChange={event => update("ai_enabled", event.target.checked)} /> AI detection</label>
      </div>
      <div className="form-actions"><button type="button" onClick={() => setStep(0)}>← Back</button><button type="button" className="primary" onClick={() => setStep(2)}>Verify →</button></div>
    </div>}
    {step === 2 && <div className="wizard-panel">
      <p className="api-import-help">Open a real frame from the camera before saving. LocalVision uses this exact stream for live view, detection, and event clips.</p>
      <button type="button" className="primary" disabled={busy === "test"} onClick={verify}>{busy === "test" ? "Connecting…" : "Test connection"}</button>
      {test && <div className={`connection-result ${test.status}`}><b>{test.status === "reachable" ? "Connection verified" : "Connection failed"}</b><span>{test.message}</span>{test.resolution && <small>{test.resolution}{test.fps ? ` · ${test.fps.toFixed(1)} fps` : ""}</small>}{test.preview && <img src={test.preview} alt="Camera preview" />}</div>}
      {test?.hints && <div className="troubleshooting"><b>Troubleshooting</b><p>{test.hints}</p></div>}
      <div className="form-actions"><button type="button" onClick={() => setStep(1)}>← Back</button><button className="primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save camera"}</button></div>
    </div>}
  </form>;
}
