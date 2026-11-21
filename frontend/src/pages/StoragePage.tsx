import { useEffect, useState } from "react";
import { storageApi } from "../services/api";
import type { StorageIntegration, StorageOverview, StorageRecording } from "../types/storage";

interface ConnectionForm { name: string; endpoint: string; apiKey: string; }

const emptyForm: ConnectionForm = { name: "Ubuntu Storage", endpoint: "", apiKey: "" };

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : "Not checked";

const statusClass = (status: string) => status === "online" ? "status-online" : status === "warning" ? "status-warning" : "status-offline";

export function StoragePage() {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [form, setForm] = useState<ConnectionForm>(emptyForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<StorageRecording | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setOverview(await storageApi.overview());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load storage information");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const update = (key: keyof ConnectionForm, value: string) => setForm(current => ({ ...current, [key]: value }));

  const openCreate = () => {
    setForm(emptyForm);
    setEditing(null);
    setShowForm(true);
    setError("");
  };

  const openEdit = (server: StorageIntegration) => {
    setForm({ name: server.name, endpoint: server.endpoint, apiKey: "" });
    setEditing(server.id);
    setShowForm(true);
    setError("");
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let result: any;
      if (editing) {
        result = await storageApi.update(editing, { name: form.name, endpoint: form.endpoint, ...(form.apiKey ? { api_key: form.apiKey } : {}) });
      } else {
        result = await storageApi.create({ name: form.name, kind: "remote_api", endpoint: form.endpoint, auth_method: "api_key", api_key: form.apiKey, enabled: true });
      }
      const state = result?.probe?.status ?? "unknown";
      setNotice(state === "online" ? "Ubuntu storage connected" : state === "warning" ? "Connected, but capacity data is incomplete" : result?.probe?.message ?? "Storage server saved");
      if (state !== "online" && state !== "warning") setError(result?.probe?.message ?? "Storage server saved but connection failed");
      setShowForm(false);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save storage server");
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: number) => {
    setError("");
    setNotice("");
    try {
      const result = await storageApi.test(id);
      setNotice(result.message || `Connection ${result.status}`);
      if (!["online", "warning"].includes(result.status)) setError(result.message);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection test failed");
    }
  };

  const remove = async (id: number, name: string) => {
    if (!window.confirm(`Remove storage server ${name}?`)) return;
    try {
      await storageApi.remove(id);
      setNotice("Storage server removed");
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove storage server");
    }
  };

  if (!overview) return <div className="page-heading"><div><span className="eyebrow">Administration / storage</span><h1>Storage management</h1>{error && <div className="error-state" role="alert">{error}</div>}{loading && <p>Loading storage…</p>}</div></div>;

  const connected = overview.servers.filter(server => server.connection === "Connected").length;
  const metrics = [
    ["Total capacity", formatBytes(overview.totals.total_bytes), `${connected} of ${overview.servers.length} servers connected`],
    ["Used", formatBytes(overview.totals.used_bytes), `${overview.totals.percent_used.toFixed(1)}% of capacity`],
    ["Available", formatBytes(overview.totals.available_bytes), "free space on Ubuntu"],
    ["Recordings", String(overview.recordings.length), `${overview.camera_count} cameras monitored`]
  ];

  return <>
    <div className="page-heading"><div><span className="eyebrow">Administration / storage</span><h1>Storage management</h1><p>Ubuntu handles every recording file; Cloudflare only manages the dashboard.</p></div><div className="camera-page-actions"><button onClick={() => void load(true)}>Refresh</button><button className="primary" onClick={openCreate}>Connect storage</button></div></div>
    {notice && <div className="notice inline-notice" role="status" onClick={() => setNotice("")}>{notice} <b>×</b></div>}
    {error && <div className="error-state" role="alert">{error}</div>}
    <div className="metrics">{metrics.map(([label, value, hint]) => <div key={label}><small>{label}</small><b>{value}</b><span>{hint}</span></div>)}</div>

    <section className="settings-panel">
      <div className="section-title"><h2>Ubuntu storage connection</h2><span>{connected ? "Connected" : "Disconnected"}</span></div>
      {!overview.servers.length && <div className="empty-state">No storage server connected. Add your Ubuntu API URL and API key to begin.</div>}
      <div className="storage-server-grid">
        {overview.servers.map(server => <article className="storage-server-card" key={server.id}>
          <div className="storage-server-head"><div><h3>{server.name}</h3><p>Remote API · {server.auth_method}</p></div><span className={`storage-status ${statusClass(server.last_status)}`}>{server.connection}</span></div>
          <small className="storage-endpoint">{server.endpoint}</small>
          {server.probe?.usage ? <><div className="storage-bar"><i style={{ width: `${Math.min(server.probe.usage.percent_used, 100)}%` }} /></div><div className="storage-bar-labels"><span>{formatBytes(server.probe.usage.used_bytes)} used</span><span>{formatBytes(server.probe.usage.available_bytes)} free</span><span>{formatBytes(server.probe.usage.total_bytes)} total</span></div></> : <p className="storage-muted">{server.last_error || server.probe?.message || "No capacity data"}</p>}
          <small className="storage-muted">Last checked {formatDate(server.last_checked_at)}</small>
          <div className="storage-actions"><button onClick={() => void test(server.id)}>Test connection</button><button onClick={() => openEdit(server)}>Edit</button><button onClick={() => void remove(server.id, server.name)}>Delete</button></div>
        </article>)}
      </div>
    </section>

    <section className="settings-panel">
      <div className="section-title"><h2>Camera recording status</h2><span>{overview.cameras.length} cameras</span></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Camera</th><th>Status</th><th>Recordings</th><th>Used</th><th>Available</th><th>Usage</th></tr></thead><tbody>
        {overview.cameras.map(camera => <tr key={camera.id}><td><b>{camera.name}</b><small>#{camera.id}</small></td><td><span className={`storage-status ${statusClass(camera.status)}`}>{camera.status}</span></td><td>{camera.recording_count}</td><td>{formatBytes(camera.used_bytes)}</td><td>{formatBytes(camera.available_bytes)}</td><td><div className="table-bar"><i style={{ width: `${Math.min(camera.percent_used, 100)}%` }} /></div><small>{camera.percent_used.toFixed(1)}%</small></td></tr>)}
        {!overview.cameras.length && <tr><td colSpan={6}>No cameras found.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="settings-panel">
      <div className="section-title"><h2>Recording files</h2><span>Stored only on Ubuntu</span></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>File</th><th>Camera</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead><tbody>
        {overview.recordings.map(recording => <tr key={`${recording.server_id}-${recording.id}`}><td><b>{recording.name}</b><small>{recording.path}</small></td><td>{recording.camera_id ?? "—"}</td><td>{formatBytes(recording.size_bytes)}</td><td>{formatDate(recording.created_at)}</td><td><div className="storage-actions"><button onClick={() => setPlaying(recording)}>Play</button><a className="button-link" href={recording.downloadUrl} download>Download</a></div></td></tr>)}
        {!overview.recordings.length && <tr><td colSpan={5}>No recording files found on the connected Ubuntu storage server.</td></tr>}
      </tbody></table></div>
    </section>

    {showForm && <div className="modal-backdrop"><form className="camera-form" onSubmit={save}>
      <div className="form-heading"><div><span className="eyebrow">Storage server</span><h2>{editing ? "Edit storage connection" : "Connect Ubuntu storage"}</h2></div><button type="button" className="close-button" onClick={() => setShowForm(false)}>×</button></div>
      <p className="api-import-help">Enter the base URL of your Ubuntu storage API, for example <code>https://storage.example.com</code>. The API key is encrypted and never displayed again.</p>
      {error && <div className="error-state" role="alert">{error}</div>}
      <div className="form-grid">
        <label>Display name<input required value={form.name} onChange={event => update("name", event.target.value)} /></label>
        <label>API URL<input required type="url" value={form.endpoint} placeholder="https://storage.example.com" onChange={event => update("endpoint", event.target.value)} /></label>
        <label>API key<input required={!editing} type="password" value={form.apiKey} autoComplete="off" placeholder={editing ? "Leave blank to keep current key" : "Storage API key"} onChange={event => update("apiKey", event.target.value)} /></label>
      </div>
      <div className="form-actions"><button type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary" disabled={busy} type="submit">{busy ? "Connecting…" : editing ? "Save & reconnect" : "Connect & save"}</button></div>
    </form></div>}

    {playing && <div className="modal-backdrop"><div className="camera-form"><div className="form-heading"><div><span className="eyebrow">Recording playback</span><h2>{playing.name}</h2></div><button type="button" className="close-button" onClick={() => setPlaying(null)}>×</button></div><video className="recording-player" controls autoPlay src={playing.fileUrl} /><div className="form-actions"><a className="button-link" href={playing.downloadUrl} download>Download</a><button type="button" onClick={() => setPlaying(null)}>Close</button></div></div></div>}
  </>;
}
