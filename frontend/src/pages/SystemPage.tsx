import { useCallback, useEffect, useRef, useState } from "react";
import { PlaceholderPage } from "./PlaceholderPage";
import { adminMonitoringApi, monitoringApi } from "../services/api";
import type { Role } from "../types/auth";
import type { Metrics } from "../types/operations";
import type { MonitoringFilters, MonitoringOverview, MonitoringUserDetail } from "../types/monitoring";

interface Props { role?: Role; }

type Tab = "users" | "cameras" | "sessions" | "activity" | "recordings";

const emptyFilters: MonitoringFilters = { username: "", date: "", session_state: "", camera_state: "", recording_state: "" };

const tabs: Array<[Tab, string]> = [
  ["users", "Users"],
  ["cameras", "Cameras"],
  ["sessions", "Sessions"],
  ["activity", "Activity"],
  ["recordings", "Recordings"]
];

const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString() : "—";

const formatBytes = (value?: number | null) => {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const statusClass = (value?: string | null) => {
  const state = String(value ?? "").toLowerCase();
  if (["online", "recording", "ok", "active", "ready", "running", "connected", "operational"].includes(state)) return "status-online";
  if (["starting", "reconnecting", "connecting", "warning", "stopped", "closed"].includes(state)) return "status-warning";
  return "status-offline";
};

const healthy = (value?: string | null) => ["ok", "running", "ready", "local-hybrid", "local-hog", "ultralytics-yolo", "online"].includes(value ?? "");

const healthState = (value?: string | null, detail?: string | null) => {
  const state = String(value ?? "").toLowerCase();
  if (healthy(state)) return { label: "Operational", className: "healthy" };
  if (state === "not_configured" || /not configured|no local ai/i.test(detail ?? "")) return { label: "Not configured", className: "neutral" };
  return { label: "Unavailable", className: "neutral" };
};

export function SystemPage({ role }: Props) {
  const [overview, setOverview] = useState<MonitoringOverview | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [filters, setFilters] = useState<MonitoringFilters>(emptyFilters);
  const [tab, setTab] = useState<Tab>("users");
  const [detail, setDetail] = useState<MonitoringUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loaded = useRef(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (role !== "admin" || busy.current) return;
    busy.current = true;
    if (!loaded.current) setLoading(true);
    try {
      const nextOverview = await adminMonitoringApi.overview(filters);
      setOverview(nextOverview);
      setMetrics(nextOverview.health ?? await monitoringApi.metrics().catch(() => null));
      setError("");
      loaded.current = true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load monitoring data");
    } finally {
      setLoading(false);
      busy.current = false;
    }
  }, [filters, role]);

  useEffect(() => {
    if (role !== "admin") return;
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load, role]);

  useEffect(() => () => { busy.current = false; }, []);

  const setFilter = (key: keyof MonitoringFilters, value: string) => setFilters(current => ({ ...current, [key]: value }));

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      setDetail(await adminMonitoringApi.user(id));
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "Could not load user report");
    } finally {
      setDetailLoading(false);
    }
  };

  if (role !== "admin") {
    return <PlaceholderPage title="System monitoring restricted" description="Only administrators can view global activity, camera, recording, and storage reports." />;
  }

  const summary = overview?.summary;
  const storageTotal = metrics?.storage.total_bytes ?? 0;
  const storagePercent = storageTotal > 0 ? Math.min(100, Math.round((metrics?.storage.used_bytes ?? 0) / storageTotal * 100)) : 0;
  const healthCards: Array<[string, string | null | undefined, string | undefined]> = [
    ["API", metrics?.api, metrics?.details?.api],
    ["Media", metrics?.media, metrics?.details?.media],
    ["Recording", metrics?.recording, metrics?.details?.recording],
    ["AI", metrics?.ai, metrics?.details?.ai]
  ];
  const summaryCards = [
    ["Accounts", String(summary?.accounts ?? "—"), `${summary?.online_users ?? 0} online`],
    ["Active sessions", String(summary?.active_sessions ?? "—"), "seen in the last 5 minutes"],
    ["Cameras online", String(summary?.online_cameras ?? "—"), `of ${summary?.cameras ?? 0} configured`],
    ["Recording now", String(summary?.recording_cameras ?? "—"), `${summary?.recordings_today ?? 0} clips today`],
    ["Recorded storage", formatBytes(summary?.recorded_bytes), "from recording metadata"],
    ["Bridge", overview?.bridge.status ?? "—", overview?.bridge.config_error || (overview?.bridge.error ?? "")]
  ];

  const emptyRow = (colSpan: number, label: string) => <tr><td colSpan={colSpan}>{label}</td></tr>;

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">Administration / system</span><h1>System monitoring</h1><p>Administrator-only account activity, camera health, recording, storage, and service telemetry.</p></div>
      <button onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh now"}</button>
    </div>
    {error && <div className="error-state" role="alert">{error}</div>}
    <div className="monitor-updated">{overview ? `Last updated ${formatTime(overview.generated_at)} · refreshes every 5 seconds` : "Loading live monitoring data…"}</div>
    <div className="metrics">
      {summaryCards.map(([label, value, detail]) => <div key={label}><small>{label}</small><b>{value}</b><span>{detail}</span></div>)}
    </div>
    <div className="system-grid">
      {healthCards.map(([label, value, detail]) => {
        const state = healthState(value, detail);
        return <div className="health-card" key={label}><small>{label}</small><b>{value === "not_configured" ? "not configured" : value ?? "—"}</b><span className={state.className}>{state.label}</span>{detail && <small className="health-detail">{detail}</small>}</div>;
      })}
      <div className="health-card wide"><small>Storage volume</small><b>{storageTotal > 0 ? `${storagePercent}% used` : "No capacity data"}</b><div className="storage-meter"><i style={{ width: `${storagePercent}%` }} /></div><span>{storageTotal > 0 ? `${formatBytes(metrics?.storage.free_bytes)} free` : metrics?.details?.storage || "Awaiting storage API"}</span>{storageTotal > 0 && metrics?.details?.storage && <small className="health-detail">{metrics.details.storage}</small>}</div>
      <div className="health-card"><small>CPU</small><b>{metrics?.cpu == null ? "Not exposed" : `${metrics.cpu}%`}</b><span>{metrics?.host === "cloudflare" ? "Serverless edge" : "Host resource"}</span>{metrics?.details?.host && <small className="health-detail">{metrics.details.host}</small>}</div>
      <div className="health-card"><small>RAM</small><b>{metrics?.ram == null ? "Not exposed" : `${metrics.ram}%`}</b><span>{metrics?.host === "cloudflare" ? "Serverless edge" : "Host resource"}</span></div>
    </div>
    <section className="settings-panel monitor-panel">
      <div className="section-title"><h2>Storage services</h2><span>{overview?.storage.servers.length ?? 0} configured integrations</span></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Service</th><th>Kind</th><th>Endpoint</th><th>Status</th><th>Last checked</th></tr></thead><tbody>
        {(overview?.storage.servers ?? []).map(server => <tr key={server.id}><td><b>{server.name}</b><small>#{server.id}</small></td><td>{server.kind}</td><td>{server.endpoint || "—"}</td><td><span className={`storage-status ${statusClass(server.last_status)}`}>{server.last_status || "unknown"}</span>{server.last_error && <small>{server.last_error}</small>}</td><td>{formatTime(server.last_checked_at)}</td></tr>)}
        {!overview?.storage.servers.length && emptyRow(5, "No storage integrations configured.")}
      </tbody></table></div>
    </section>
    <section className="settings-panel monitor-panel">
      <div className="section-title"><h2>Live monitoring</h2><span>Filter real activity and open a user for a full report</span></div>
      <div className="filter-bar monitor-filters">
        <input placeholder="Search username or owner" value={filters.username} onChange={event => setFilter("username", event.target.value)} />
        <input type="date" value={filters.date} onChange={event => setFilter("date", event.target.value)} />
        <select value={filters.session_state} onChange={event => setFilter("session_state", event.target.value)}><option value="">All session states</option><option value="online">Online</option><option value="offline">Offline</option><option value="active">Active session</option><option value="closed">Closed session</option></select>
        <select value={filters.camera_state} onChange={event => setFilter("camera_state", event.target.value)}><option value="">All camera states</option><option value="online">Online</option><option value="connecting">Connecting</option><option value="offline">Offline</option><option value="disabled">Disabled</option></select>
        <select value={filters.recording_state} onChange={event => setFilter("recording_state", event.target.value)}><option value="">All recording states</option><option value="recording">Recording</option><option value="starting">Starting</option><option value="reconnecting">Reconnecting</option><option value="stopped">Stopped</option><option value="error">Error</option><option value="disabled">Disabled</option></select>
        <button onClick={() => setFilters(emptyFilters)}>Clear filters</button>
      </div>
      <div className="monitor-tabs">{tabs.map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === "users" && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Account</th><th>Role</th><th>Session</th><th>Last seen</th><th>Cameras</th><th>Recordings</th><th>Actions</th></tr></thead><tbody>
        {(overview?.users ?? []).map(user => <tr key={user.id}><td><b>{user.username}</b><small>Created {formatDate(user.created_at)} · first login {formatTime(user.first_login_at)}</small></td><td><span className={`role-pill role-${user.role}`}>{user.role}</span></td><td><span className={`storage-status ${statusClass(user.online ? "online" : "offline")}`}>{user.online ? "online" : "offline"}</span><small>{user.active_sessions} active</small></td><td>{formatTime(user.last_seen_at)}</td><td>{user.camera_count}<small>{user.online_cameras} online · {user.recording_cameras} recording</small></td><td>{user.recording_count}<small>{user.audit_count} audit events</small></td><td><div className="table-actions"><button onClick={() => void openDetail(user.id)}>Details</button></div></td></tr>)}
        {!overview?.users.length && emptyRow(7, "No accounts match the current filters.")}
      </tbody></table></div>}
      {tab === "cameras" && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Camera</th><th>Owner</th><th>Stream</th><th>Recording</th><th>Clips</th><th>Stored</th><th>Last recording</th></tr></thead><tbody>
        {(overview?.cameras ?? []).map(camera => <tr key={camera.id}><td><b>{camera.name}</b><small>{camera.location || camera.host} · {camera.protocol}</small></td><td>{camera.owner}</td><td><span className={`storage-status ${statusClass(camera.stream_state)}`}>{camera.stream_state}</span>{camera.last_error && <small>{camera.last_error}</small>}</td><td><span className={`storage-status ${statusClass(camera.recording_state)}`}>{camera.recording_state}</span></td><td>{camera.recording_count}</td><td>{formatBytes(camera.recorded_bytes)}</td><td>{formatTime(camera.last_recording_at)}</td></tr>)}
        {!overview?.cameras.length && emptyRow(7, "No cameras match the current filters.")}
      </tbody></table></div>}
      {tab === "sessions" && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Account</th><th>Login</th><th>Last activity</th><th>Ended</th><th>State</th><th>Client</th></tr></thead><tbody>
        {(overview?.sessions ?? []).map(session => <tr key={session.id}><td><b>{session.username ?? `User #${session.user_id}`}</b><small>{String(session.id).slice(0, 12)}</small></td><td>{formatTime(session.login_at)}</td><td>{formatTime(session.last_seen_at)}</td><td>{formatTime(session.logout_at)}<small>{session.end_reason ?? ""}</small></td><td><span className={`storage-status ${statusClass(session.online ? "online" : session.active ? "warning" : "offline")}`}>{session.online ? "online" : session.active ? "idle" : "closed"}</span></td><td>{session.ip || "—"}<small>{session.user_agent || "—"}</small></td></tr>)}
        {!overview?.sessions.length && emptyRow(6, "No sessions match the current filters.")}
      </tbody></table></div>}
      {tab === "activity" && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>When</th><th>Account</th><th>Action</th><th>Target</th><th>Camera</th><th>Address</th></tr></thead><tbody>
        {(overview?.activity ?? []).map(item => <tr key={item.id}><td>{formatTime(item.created_at)}</td><td>{item.username ?? `User #${item.user_id ?? "?"}`}</td><td><b>{item.action}</b></td><td>{item.target || "—"}</td><td>{item.camera_id ?? "—"}</td><td>{item.ip || "—"}</td></tr>)}
        {!overview?.activity.length && emptyRow(6, "No audit activity matches the current filters.")}
      </tbody></table></div>}
      {tab === "recordings" && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Recording</th><th>Camera</th><th>Owner</th><th>Started</th><th>Duration</th><th>Size</th><th>Status</th></tr></thead><tbody>
        {(overview?.recordings ?? []).map(recording => <tr key={recording.id}><td><b>{recording.name}</b><small>{recording.filename}</small></td><td>{recording.camera}</td><td>{recording.owner}</td><td>{formatTime(recording.started_at)}</td><td>{recording.duration_seconds == null ? "—" : `${Math.round(recording.duration_seconds)}s`}</td><td>{formatBytes(recording.size_bytes)}</td><td><span className={`storage-status ${statusClass(recording.status)}`}>{recording.status}</span></td></tr>)}
        {!overview?.recordings.length && emptyRow(7, "No recordings match the current filters.")}
      </tbody></table></div>}
    </section>
    {detailLoading && <div className="modal-backdrop"><div className="monitoring-detail"><div className="error-state">Loading report…</div></div></div>}
    {detailError && <div className="modal-backdrop" onClick={() => setDetailError("")}><div className="monitoring-detail" onClick={event => event.stopPropagation()}><div className="error-state">{detailError}</div></div></div>}
    {detail && <div className="modal-backdrop" onClick={() => setDetail(null)}><section className="monitoring-detail" onClick={event => event.stopPropagation()}>
      <div className="form-heading"><div><span className="eyebrow">Administrator report</span><h2>{detail.user.username}</h2></div><button type="button" className="close-button" onClick={() => setDetail(null)}>×</button></div>
      <div className="detail-grid">
        <div><small>Account created</small><b>{formatTime(detail.user.created_at)}</b></div>
        <div><small>First login</small><b>{formatTime(detail.summary.first_login_at)}</b></div>
        <div><small>Last activity</small><b>{formatTime(detail.summary.last_seen_at)}</b></div>
        <div><small>Sessions</small><b>{detail.summary.active_sessions} active · {detail.summary.total_sessions} total</b></div>
        <div><small>Cameras created</small><b>{detail.summary.cameras}</b></div>
        <div><small>Recordings / events</small><b>{detail.summary.recordings} / {detail.summary.events}</b></div>
      </div>
      <div className="detail-section"><h3>Cameras</h3><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Location</th><th>Host</th><th>Created</th></tr></thead><tbody>{detail.cameras.map(camera => <tr key={camera.id}><td><b>{camera.name}</b></td><td>{camera.location || "—"}</td><td>{camera.host}</td><td>{formatTime(camera.created_at)}</td></tr>)}{!detail.cameras.length && emptyRow(4, "No cameras assigned to this account.")}</tbody></table></div></div>
      <div className="detail-section"><h3>Sessions</h3><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Login</th><th>Last seen</th><th>Ended</th><th>State</th><th>Address</th></tr></thead><tbody>{detail.sessions.map(session => <tr key={session.id}><td>{formatTime(session.login_at)}</td><td>{formatTime(session.last_seen_at)}</td><td>{formatTime(session.logout_at)}</td><td>{session.end_reason ?? (session.online ? "online" : session.active ? "active" : "closed")}</td><td>{session.ip || "—"}</td></tr>)}{!detail.sessions.length && emptyRow(5, "No sessions recorded for this account.")}</tbody></table></div></div>
      <div className="detail-section"><h3>Activity</h3><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Camera</th></tr></thead><tbody>{detail.activity.map(item => <tr key={item.id}><td>{formatTime(item.created_at)}</td><td><b>{item.action}</b></td><td>{item.target || "—"}</td><td>{item.camera_id ?? "—"}</td></tr>)}{!detail.activity.length && emptyRow(4, "No audit events recorded for this account.")}</tbody></table></div></div>
      <div className="detail-section"><h3>Recordings</h3><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Name</th><th>Started</th><th>Duration</th><th>Size</th></tr></thead><tbody>{detail.recordings.map(recording => <tr key={recording.id}><td><b>{recording.name}</b></td><td>{formatTime(recording.started_at)}</td><td>{recording.duration_seconds == null ? "—" : `${Math.round(recording.duration_seconds)}s`}</td><td>{formatBytes(recording.size_bytes)}</td></tr>)}{!detail.recordings.length && emptyRow(4, "No recordings for cameras owned by this account.")}</tbody></table></div></div>
      <div className="detail-section"><h3>Events</h3><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>When</th><th>Kind</th><th>Object</th><th>Description</th></tr></thead><tbody>{detail.events.map(event => <tr key={event.id}><td>{formatTime(event.occurred_at)}</td><td>{event.kind}</td><td>{event.object_name ?? "—"}</td><td>{event.description ?? "—"}</td></tr>)}{!detail.events.length && emptyRow(4, "No events for cameras owned by this account.")}</tbody></table></div></div>
    </section></div>}
  </>;
}
