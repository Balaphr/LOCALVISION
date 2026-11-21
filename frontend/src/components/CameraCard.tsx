import { useState } from "react";
import type { Camera } from "../types/camera";
import { cameraApi } from "../services/api";

interface Props {
  camera: Camera;
  canWrite: boolean;
  onEdit: (camera: Camera) => void;
  onDelete: (camera: Camera) => void;
}

export function CameraCard({ camera, canWrite, onEdit, onDelete }: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState("");

  const test = async () => {
    setTesting(true);
    setResult("");
    try {
      const status = await cameraApi.test(camera.id);
      setResult(status.message ?? status.status);
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  return <article className="camera-card">
    <div className="camera-visual">
      <span className="live-badge">● {camera.enabled ? "ENABLED" : "DISABLED"}</span>
      <span className="camera-resolution">{camera.main_stream || camera.rtsp_url ? "STREAM CONFIGURED" : "NO STREAM URL"}</span>
    </div>
    <div className="camera-card-body"><div><h3>{camera.name}</h3><p>{camera.location || "No location"}</p></div><span className={`status-dot ${camera.enabled ? "online" : "offline"}`} /></div>
    <div className="camera-tags"><span>{camera.protocol}</span><span>{camera.recording_enabled ? "● Continuous" : "○ Recording off"}</span><span>{camera.ai_enabled ? "✦ AI on" : "AI off"}</span></div>
    {result && <p className="camera-test-result">{result}</p>}
    <div className="camera-actions"><button onClick={() => void test()} disabled={!camera.enabled || testing}>{testing ? "Testing…" : "Test stream"}</button><button disabled={!canWrite} onClick={() => onEdit(camera)}>Edit</button><button className="danger" disabled={!canWrite} onClick={() => onDelete(camera)}>Delete</button></div>
  </article>;
}
