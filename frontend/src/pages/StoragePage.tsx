import { useEffect, useState } from "react";
import { storageApi } from "../services/api";
import type { StorageIntegrationInput, StorageKind, StorageOverview } from "../types/storage";

const emptyForm: StorageIntegrationInput = { name: "", kind: "remote_api", endpoint: "", base_path: "", bucket: "", region: "", auth_method: "none", secret: "", enabled: true };

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
  const [form, setForm] = useState<StorageIntegrationInput>(emptyForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setOverview(await storageApi.overview());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load storage information");
    }
  };

  useEffect(() => { void load(); }, []);

  const update = (key: keyof StorageIntegrationInput, value: string | boolean) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const openCreate = () => {
    setForm(emptyForm);
    setEditing(null);
    setShowForm(true);
    setError("");
  };

  const openEdit = (server: StorageOverview["servers"][number]) => {
    setForm({
      name: server.name,
      kind: server.kind as StorageKind,
      endpoint: server.endpoint,
      base_path: server.base_path ?? "",
      bucket: server.bucket ?? "",
      region: server.region ?? "",
      auth_method: server.auth_method as StorageIntegrationInput["auth_method"],
      secret: "",
      enabled: server.enabled,
    });
    setEditing(server.id);
    setShowForm(true);
    setError("");
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form, secret: form.secret || undefined };
      if (editing) await storageApi.update(editing, payload);
      else await storageApi.create(payload);
      setShowForm(false);
      setNotice(editing ? "Storage server updated" : "Storage server added");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save storage server");
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: number) => {
    try {
      const result = await storageApi.test(id);
      setNotice(`${result.status.toUpperCase()}: ${result.message}`);
      setError(result.status === "error" || result.status === "offline" ? result.message : "");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connection test failed");
    }
  };

  const remove = async (id: number, name: string) => {
    if (!window.confirm(`Remove storage server ${name}?`)) return;
    try {
      await storageApi.remove(id);
      setNotice("Storage server removed");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove storage server");
    }
  };

  if (!overview) return <div className="page-heading"><div><span className="eyebrow">Administration / storage</span><h1>Storage management</h1></div>{error && <div className="error-state">{error}</div>}</div>;

  const metrics = [
    ["Total capacity", formatBytes(overview.totals.total_bytes), `${overview.servers.length} connected server${overview.servers.length === 1 ? "" : "s"}`],
    ["Used", formatBytes(overview.totals.used_bytes), `${overview.totals.percent_used.toFixed(1)}% of capacity`],
    ["Available", formatBytes(overview.totals.available_bytes), "free space"],
    ["Cameras", String(overview.camera_count), "storage profiles tracked"],
  ];

  return <>
    <div className="page-heading"><div><span className="eyebrow">Administration / storage</span><h1>Storage management</h1><p>Local volume, external storage APIs, connection health, and camera usage in one place.</p></div><button className="primary" onClick={openCreate}>Add storage server</button></div>
    {notice && <div className="notice inline-notice" role="status" onClick={() => setNotice("")}>{notice} <b>×</b></div>}
    {error && <div className="error-state" role="alert">{error}</div>}
    <div className="metrics">{metrics.map(([label, value, hint]) => <div key={label}><small>{label}</small><b>{value}</b><span>{hint}</span></div>)}</div>
    <section className="settings-panel storage-local-panel">
      <div className="section-title"><h2>Local primary storage</h2><span>{overview.local.source}</span></div>
      <div className="storage-bar"><i style={{ width: `${Math.min(overview.local.percent_used, 100)}%` }} /></div>
      <div className="storage-bar-labels"><span>{formatBytes(overview.local.used_bytes)} used</span><span>{formatBytes(overview.local.available_bytes)} free</span><span>{formatBytes(overview.local.total_bytes)} total</span></div>
    </section>
    <section className="settings-panel">
      <div className="section-title"><h2>Connected storage servers</h2><span>{overview.servers.length} configured</span></div>
      <div className="storage-server-grid">
        {overview.servers.map(server => <article className="storage-server-card" key={server.id}>
          <div className="storage-server-head"><div><h3>{server.name}</h3><p>{server.kind === "local_mount" ? "Local mount" : "Remote API"} · {server.auth_method}</p></div><span className={`storage-status ${statusClass(server.last_status)}`}>{server.last_status}</span></div>
          <small className="storage-endpoint">{server.base_path || server.endpoint}</small>
          {server.bucket && <small>{server.bucket}{server.region ? ` · ${server.region}` : ""}</small>}
          {server.usage ? <><div className="storage-bar"><i style={{ width: `${Math.min(server.usage.percent_used, 100)}%` }} /></div><div className="storage-bar-labels"><span>{formatBytes(server.usage.used_bytes)}</span><span>{formatBytes(server.usage.available_bytes)} free</span></div></> : <p className="storage-muted">{server.last_error || "No capacity data"}</p>}
          <small className="storage-muted">Last checked {formatDate(server.last_checked_at)}</small>
          <div className="storage-actions"><button onClick={() => void test(server.id)}>Test connection</button><button onClick={() => openEdit(server)}>Edit</button><button onClick={() => void remove(server.id, server.name)}>Delete</button></div>
        </article>)}
        {!overview.servers.length && <div className="empty-state">No external storage servers configured. Add a storage API or local mount above.</div>}
      </div>
    </section>
    <section className="settings-panel">
      <div className="section-title"><h2>Camera storage details</h2><span>{overview.cameras.length} cameras</span></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Camera</th><th>Connection</th><th>Owner</th><th>Protocol</th><th>Used</th><th>Available</th><th>Usage</th></tr></thead><tbody>
        {overview.cameras.map(camera => <tr key={camera.id}><td><b>{camera.name}</b><small>#{camera.id}</small></td><td><span className={`storage-status ${statusClass(camera.status)}`}>{camera.status}</span></td><td>{camera.owner ?? "Unassigned"}</td><td>{camera.protocol}</td><td>{formatBytes(camera.used_bytes)}</td><td>{formatBytes(camera.available_bytes)}</td><td><div className="table-bar"><i style={{ width: `${Math.min(camera.percent_used, 100)}%` }} /></div><small>{camera.percent_used.toFixed(1)}%</small></td></tr>)}
        {!overview.cameras.length && <tr><td colSpan={7}>No cameras found.</td></tr>}
      </tbody></table></div>
    </section>
    {showForm && <div className="modal-backdrop"><form className="camera-form" onSubmit={save}>
      <div className="form-heading"><div><span className="eyebrow">Storage server</span><h2>{editing ? "Edit storage details" : "Add storage server"}</h2></div><button type="button" className="close-button" onClick={() => setShowForm(false)}>×</button></div>
      <div className="form-grid">
        <label>Name<input required value={form.name} onChange={event => update("name", event.target.value)} /></label>
        <label>Type<select value={form.kind} onChange={event => update("kind", event.target.value)}><option value="remote_api">Remote storage API</option><option value="local_mount">Local mount / path</option></select></label>
        {form.kind === "remote_api" ? <label>API endpoint<input required type="url" value={form.endpoint} placeholder="https://storage.example.com/api/usage" onChange={event => update("endpoint", event.target.value)} /></label> : <label>Mount path<input required value={form.base_path || form.endpoint} placeholder="/mnt/storage" onChange={event => update("endpoint", event.target.value)} /></label>}
        <label>Authentication<select value={form.auth_method} onChange={event => update("auth_method", event.target.value)}><option value="none">None</option><option value="bearer">Bearer token</option><option value="basic">Basic auth</option><option value="api_key">API key</option></select></label>
        <label>Bucket / share<input value={form.bucket ?? ""} onChange={event => update("bucket", event.target.value)} /></label>
        <label>Region<input value={form.region ?? ""} onChange={event => update("region", event.target.value)} /></label>
        <label>Secret<input type="password" value={form.secret ?? ""} placeholder={editing ? "Leave blank to keep current secret" : "Optional"} autoComplete="off" onChange={event => update("secret", event.target.value)} /></label>
      </div>
      <div className="toggle-row"><label><input type="checkbox" checked={form.enabled} onChange={event => update("enabled", event.target.checked)} /> Enabled</label></div>
      <div className="form-actions"><button type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary" disabled={busy} type="submit">{busy ? "Saving…" : editing ? "Save changes" : "Add server"}</button></div>
    </form></div>}
  </>;
}
