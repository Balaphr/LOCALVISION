import { useEffect, useMemo, useState } from "react";
import type { Camera } from "../types/camera";
import type { EventItem, Metrics } from "../types/operations";
import { operationsApi, recordingApi } from "../services/api";
import type { User } from "../types/auth";

interface Props { cameras: Camera[]; user: User; }

export function Dashboard({ cameras, user }: Props) {
	const [events, setEvents] = useState<EventItem[]>([]);
	const [metrics, setMetrics] = useState<Metrics | null>(null);
	const [recordingCount, setRecordingCount] = useState<number | null>(null);
	const [error, setError] = useState("");
	const [loadedAt, setLoadedAt] = useState<Date | null>(null);

	useEffect(() => {
		void Promise.all([operationsApi.events(), operationsApi.metrics(), recordingApi.list({})])
			.then(([eventResult, metricResult, recordingResult]) => {
				setEvents(eventResult.items);
				setMetrics(metricResult);
				setRecordingCount(recordingResult.items.length);
				setLoadedAt(new Date());
			})
			.catch(reason => setError(reason instanceof Error ? reason.message : "Dashboard data unavailable"));
	}, []);

	const online = cameras.filter(camera => camera.enabled).length;
	const offline = cameras.length - online;
	const used = metrics?.storage.total_bytes ? Math.round(metrics.storage.used_bytes / metrics.storage.total_bytes * 100) : null;
	const people = useMemo(() => events.filter(event => event.object_name?.toLowerCase() === "person").length, [events]);
	const vehicles = useMemo(() => events.filter(event => ["car", "vehicle", "motorcycle", "bicycle"].includes(event.object_name?.toLowerCase() ?? "")).length, [events]);
	const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
	const serviceRows = [["API", metrics?.api], ["Media", metrics?.media], ["Recording", metrics?.recording], ["AI engine", metrics?.ai]];
	const isHealthy = (value: string | null | undefined) => ["ok", "running", "ready", "local-hybrid", "local-hog"].includes(value ?? "");

	return <><div className="page-heading"><div><span className="eyebrow">Operations / overview · {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span><h1>{greeting}, {user.username}</h1><p>Here is what is happening across your property.</p></div><span className="dashboard-refresh">{loadedAt ? `Updated ${loadedAt.toLocaleTimeString()}` : "Loading analytics…"}</span></div>{error && <div className="error-state">{error}</div>}<div className="metrics"><div><small>Total cameras</small><b>{cameras.length}</b><span>{online} online · {offline} offline</span></div><div><small>AI events today</small><b>{events.length}</b><span>{people} people · {vehicles} vehicles</span></div><div><small>Recordings indexed</small><b>{recordingCount == null ? "—" : recordingCount}</b><span>{metrics?.recording ?? "Recording status unavailable"}</span></div><div><small>Storage used</small><b>{used == null ? "—" : `${used}%`}</b><span>{metrics?.storage.low ? "LOW SPACE" : "Local volume"}</span></div></div><div className="analytics-grid"><section className="panel analytics-wide"><div className="section-title"><h2>Camera health</h2><span>{online}/{cameras.length} online</span></div><div className="health-bars">{cameras.slice(0, 8).map(camera => <div className="health-bar-row" key={camera.id}><span>{camera.name}</span><i><b className={camera.enabled ? "online" : "offline"} /></i><small>{camera.enabled ? "Online" : "Offline"}</small></div>)}{!cameras.length && <div className="empty-state">No camera health data returned by the API.</div>}</div></section><section className="panel"><div className="section-title"><h2>Service health</h2><span>Live API</span></div><div className="service-list">{serviceRows.map(([label, value]) => <div className="service-row" key={label}><span><i className={isHealthy(value) ? "online" : "offline"} />{label}</span><b>{value ?? "—"}</b></div>)}</div></section><section className="panel"><div className="section-title"><h2>Detection mix</h2><span>{events.length} events</span></div><div className="detection-mix"><div><b>{people}</b><span>Person</span></div><div><b>{vehicles}</b><span>Vehicle</span></div><div><b>{Math.max(events.length - people - vehicles, 0)}</b><span>Other</span></div></div>{!events.length && <div className="empty-state">No detection data returned by the API.</div>}</section><section className="panel analytics-wide"><div className="section-title"><h2>Recent activity</h2><span>From event stream</span></div>{events.slice(0, 6).map(event => <div className="event-row" key={event.id}><i className={event.kind.includes("offline") ? "critical" : ""}>◌</i><div><b>{event.object_name ?? event.kind}</b><small>{new Date(event.occurred_at).toLocaleString()} · {event.confidence == null ? "No confidence" : `${Math.round(event.confidence * 100)}% confidence`}</small></div></div>)}{!events.length && <div className="empty-state">No recent activity returned by the API.</div>}</section></div></>;
}
