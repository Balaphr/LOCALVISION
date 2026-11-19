import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { CameraForm } from "./components/CameraForm";
import { cameraApi } from "./services/api";
import type { Camera, CameraInput } from "./types/camera";
import { CamerasPage } from "./pages/CamerasPage";
import { Dashboard } from "./pages/Dashboard";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RecordingsPage } from "./pages/RecordingsPage";
import { ZoneEditor } from "./pages/ZoneEditor";
import { LivePage } from "./pages/LivePage";
import { AIHub } from "./pages/AIHub";
import { EventsPage } from "./pages/EventsPage";
import { AlertsPage } from "./pages/AlertsPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { SystemPage } from "./pages/SystemPage";
import { LandingPage } from "./pages/LandingPage";
import { AccountSettings } from "./pages/AccountSettings";
import { SharingPage } from "./pages/SharingPage";
import { authApi } from "./services/api";
import type { User } from "./types/auth";
import "./styles.css";
import { useRealtime } from "./hooks/useRealtime";
import type { RealtimeMessage } from "./hooks/useRealtime";
import { SplashScreen } from "./components/SplashScreen";

const labels: Record<string, [string, string]> = { live: ["Live View", "Low-latency playback is provided by the configured media gateway."], events: ["Events", "Review local AI and system events."], alerts: ["Alerts", "Review and configure optional notification providers."], storage: ["Storage", "Review local volume and retention health."], users: ["Users", "Manage users and roles."], integrations: ["API Integrations", "Configure optional encrypted webhook integrations."], settings: ["Settings", "Configure LocalVision runtime settings."], system: ["System", "Review service and host health."] };

export default function App() {
  const [user, setUser] = useState<User | null>(null); const [authLoading, setAuthLoading] = useState(true); const [showSplash, setShowSplash] = useState(false); const [showLanding, setShowLanding] = useState(true); const [page, setPage] = useState("dashboard"); const [cameras, setCameras] = useState<Camera[]>([]); const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<Camera | null>(null);   const [notice, setNotice] = useState(""); const [detections, setDetections] = useState<RealtimeMessage[]>([]);
  useEffect(() => { void authApi.me().then(nextUser => { setUser(nextUser); setShowSplash(true); }).catch(() => setUser(null)).finally(() => setAuthLoading(false)); }, []);
  const handleRealtime = useCallback((message: RealtimeMessage) => {
    if (message.type === "detection") setDetections(current => [message, ...current].slice(0, 16));
    if (["alert", "storage_warning", "recording_error"].includes(message.type)) setNotice(String(message.message ?? message.type).replaceAll("_", " "));
  }, []);
  useRealtime(handleRealtime);
  const refresh = async () => { try { setCameras(await cameraApi.list()); } catch (error) { setNotice(error instanceof Error ? error.message : "API is unavailable"); } };
  useEffect(() => { void refresh(); }, []);
  const save = async (input: CameraInput) => { try { if (editing) await cameraApi.update(editing.id, input); else await cameraApi.create(input); setFormOpen(false); setEditing(null); setNotice("Camera saved"); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save camera"); } };
  const remove = async (camera: Camera) => { if (!window.confirm(`Delete ${camera.name}?`)) return; try { await cameraApi.remove(camera.id); setNotice("Camera deleted"); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not delete camera"); } };
  const test = async (camera: Camera) => { try { const result = await cameraApi.test(camera.id); setNotice(`${camera.name}: ${result.status === "reachable" ? result.message : result.hints ?? result.message}`); } catch (error) { setNotice(error instanceof Error ? error.message : "Connection test failed"); } };
  const importCameras = async (endpoint: string, apiKey: string) => { const result = await cameraApi.importFromApi(endpoint, apiKey); await refresh(); setNotice(`Imported ${result.imported} camera${result.imported === 1 ? "" : "s"}${result.skipped ? `; skipped ${result.skipped} already added` : ""}`); return result; };
  if (authLoading) return <div className="loading-screen">Checking secure session…</div>;
  if (showLanding || !user) return <LandingPage onAuthenticated={nextUser => { setUser(nextUser); setPage("dashboard"); setShowSplash(true); setShowLanding(false); }} />;
  if (showSplash) return <SplashScreen onComplete={() => setShowSplash(false)} />;
  const content = page === "dashboard" ? <Dashboard cameras={cameras} user={user} /> : page === "live" ? <LivePage cameras={cameras} detections={detections} /> : page === "cameras" ? <CamerasPage cameras={cameras} onAdd={() => { setEditing(null); setFormOpen(true); }} onEdit={camera => { setEditing(camera); setFormOpen(true); }} onDelete={remove} onTest={test} onImport={importCameras} /> : page === "recordings" ? <RecordingsPage cameras={cameras} /> : page === "ai" ? <AIHub cameras={cameras} /> : page === "events" ? <EventsPage cameras={cameras} /> : page === "alerts" ? <AlertsPage /> : page === "sharing" ? <SharingPage /> : page === "integrations" ? <IntegrationsPage /> : page === "settings" ? <AccountSettings user={user} onLogout={async () => { await authApi.logout(); setUser(null); }} /> : page === "system" ? <SystemPage /> : <PlaceholderPage title={labels[page]?.[0] ?? page} description={labels[page]?.[1] ?? "This area is ready for the next implementation phase."} />;
  return <div className="app"><Sidebar active={page} onNavigate={setPage} /><main className="main"><header className="topbar"><button className="mobile-menu" onClick={() => document.querySelector('.sidebar')?.classList.toggle('open')}>☰</button><div className="user-area"><span className="connection"><i /> {user.role.toUpperCase()} · session active</span><button className="avatar" aria-label="Open account settings" onClick={() => setPage("settings")}>{user.username.slice(0, 2).toUpperCase()}</button></div></header>{notice && <div className="notice" onClick={() => setNotice("")}>{notice} <b>×</b></div>}{content}</main>{formOpen && <div className="modal-backdrop"><CameraForm camera={editing} onSave={save} onCancel={() => { setFormOpen(false); setEditing(null); }} /></div>}</div>;
}
