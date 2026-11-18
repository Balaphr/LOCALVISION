import { useState } from "react";
import type { Camera, CameraInput } from "../types/camera";
import { CameraCard } from "../components/CameraCard";
interface Props { cameras: Camera[]; onAdd: () => void; onEdit: (camera: Camera) => void; onDelete: (camera: Camera) => void; onTest: (camera: Camera) => void; onImport: (endpoint: string, apiKey: string) => Promise<{ imported: number; skipped: number }>; }
export function CamerasPage({ cameras, onAdd, onEdit, onDelete, onTest, onImport }: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const closeImport = () => {
    setImportOpen(false);
    setEndpoint("");
    setApiKey("");
    setError("");
  };
  const submitImport = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setImporting(true);
    try {
      await onImport(endpoint, apiKey);
      closeImport();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import cameras");
    } finally {
      setImporting(false);
    }
  };
  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Camera manager</span><h1>Your cameras</h1><p>Manage local connections without exposing camera credentials.</p></div>
      <div className="camera-page-actions"><button className="api-import-button" onClick={() => setImportOpen(true)}>Import from API</button><button className="primary" onClick={onAdd}>＋ Add camera</button></div>
    </div>
    <div className="camera-grid">{cameras.map(camera => <CameraCard key={camera.id} camera={camera} onEdit={onEdit} onDelete={onDelete} onTest={onTest} />)}{!cameras.length && <div className="empty-state">No cameras configured yet.<br /><button className="primary" onClick={onAdd}>Add your first camera</button></div>}</div>
    {importOpen && <div className="modal-backdrop"><form className="camera-form" onSubmit={submitImport}>
      <div className="form-heading"><div><span className="eyebrow">Camera manager</span><h2>Import cameras from API</h2></div><button type="button" className="close-button" onClick={closeImport}>×</button></div>
      <p className="api-import-help">The endpoint must accept a GET request with the key in the X-API-Key header and return a JSON array of cameras. Each camera needs a name and host; optional fields follow the manual camera form. The key is not stored.</p>
      <div className="form-grid"><label>Camera list endpoint<input type="url" required value={endpoint} placeholder="https://camera-service.example/api/cameras" onChange={event => setEndpoint(event.target.value)} /></label><label>API key<input type="password" required value={apiKey} autoComplete="off" onChange={event => setApiKey(event.target.value)} /></label></div>
      {error && <div className="error-state" role="alert">{error}</div>}
      <div className="form-actions"><button type="button" onClick={closeImport}>Cancel</button><button className="primary" disabled={importing}>{importing ? "Importing…" : "Import cameras"}</button></div>
    </form></div>}
  </>;
}
