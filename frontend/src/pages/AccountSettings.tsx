import { useEffect, useState } from "react";
import type { Camera } from "../types/camera";
import type { Metrics } from "../types/operations";
import type { Role, User, UserRecord } from "../types/auth";
import { authApi, cameraApi, monitoringApi, settingsApi, userApi } from "../services/api";

const groups = [["account", "Account"], ["access-control", "Admin access control"], ["subaccount", "Subaccount setup"], ["user-credentials", "Username & password"], ["appearance", "Appearance"], ["accessibility", "Accessibility"], ["sessions", "Devices & sessions"], ["sharing", "Sharing & permissions"], ["cameras", "Cameras"], ["storage", "Storage & memory"], ["ai", "AI account settings"], ["about", "About"]];

interface Props { user: User; canManageUsers: boolean; onLogout: () => Promise<void>; }

export function AccountSettings({ user, canManageUsers, onLogout }: Props) {
  const [section, setSection] = useState("account");
  const [theme, setTheme] = useState("system");
  const [density, setDensity] = useState("comfortable");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [largerText, setLargerText] = useState(false);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [runtime, setRuntime] = useState<{ version: string; environment: string; storage_path: string; secrets_configured: boolean } | null>(null);
  const [subaccounts, setSubaccounts] = useState<UserRecord[]>([]);
  const [subaccountUsername, setSubaccountUsername] = useState("");
  const [subaccountPassword, setSubaccountPassword] = useState("");
  const [subaccountRole, setSubaccountRole] = useState<Role>("viewer");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void cameraApi.list().then(setCameras).catch(() => undefined);
    void monitoringApi.metrics().then(setMetrics).catch(() => undefined);
    if (!canManageUsers) return;
    void settingsApi.get().then(setRuntime).catch(() => undefined);
    void userApi.list().then(setSubaccounts).catch(() => undefined);
  }, [canManageUsers]);

  const applyAppearance = (nextTheme: string, nextDensity: string) => {
    setTheme(nextTheme);
    setDensity(nextDensity);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.dataset.density = nextDensity;
    document.documentElement.classList.toggle("reduce-motion", reducedMotion);
    document.documentElement.classList.toggle("high-contrast", highContrast);
    document.documentElement.classList.toggle("large-text", largerText);
  };

  const createSubaccount = async () => {
    if (!canManageUsers) return setNotice("Administrator access is required");
    if (!subaccountUsername || subaccountPassword.length < 8) return setNotice("Enter a username and a password of at least 8 characters");
    try {
      const created = await userApi.create({ username: subaccountUsername, password: subaccountPassword, role: subaccountRole, is_active: true });
      setSubaccounts([...subaccounts, created]);
      setSubaccountUsername("");
      setSubaccountPassword("");
      setSubaccountRole("viewer");
      setNotice(`Subaccount "${created.username}" created`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to create subaccount");
    }
  };

  const deleteSubaccount = async (id: number) => {
    if (!canManageUsers) return setNotice("Administrator access is required");
    if (!window.confirm("Remove this subaccount?")) return;
    try {
      await userApi.remove(id);
      setSubaccounts(subaccounts.filter(account => account.id !== id));
      setNotice("Subaccount removed");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to remove subaccount");
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) return setNotice("New passwords do not match");
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password updated");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to update password");
    }
  };

  const logoutAll = async () => {
    if (!window.confirm("Log out this account from all devices?")) return;
    try {
      await userApi.revokeSessions(user.id);
      await onLogout();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not revoke sessions");
    }
  };

  return <>
    <div className="page-heading"><div><span className="eyebrow">Settings / account</span><h1>Account settings</h1><p>Control your identity, workspace preferences, privacy, and local access.</p></div><button className="danger-button" onClick={() => void onLogout()}>Log out</button></div>
    {notice && <div className="notice inline-notice" role="status" onClick={() => setNotice("")}>{notice} <b>×</b></div>}
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Account settings sections">{groups.map(([id, label]) => <button className={section === id ? "active" : ""} key={id} onClick={() => setSection(id)}>{label}</button>)}</nav>
      <section className="settings-content">
        {section === "account" && <SettingsPanel title="Account"><div className="profile-header"><div className="avatar large-avatar">{user.username.slice(0, 2).toUpperCase()}</div><div><h2>{user.username}</h2><p>{user.role} access · authenticated session active</p></div></div><div className="settings-form-grid"><label>Profile name<input value={user.username} readOnly /></label><label>Email<input placeholder="Not provided by API" disabled /></label></div><div className="settings-actions"><button onClick={() => setSection("user-credentials")}>Change password</button>{canManageUsers && <button onClick={() => setSection("subaccount")}>Manage subaccounts</button>}</div><Unavailable title="Login history" detail="Use the audit log in Administration to review login events." /><Unavailable title="Profile picture" detail="No profile image endpoint is configured." /></SettingsPanel>}
        {section === "access-control" && <SettingsPanel title="Admin access control">{canManageUsers ? <><p>Administrators can create accounts, assign permissions, revoke sessions, and manage storage connections from the dedicated administration pages.</p><div className="settings-actions"><button onClick={() => setSection("subaccount")}>Open subaccount setup</button></div></> : <Unavailable title="Admin access control" detail="Administrator role required." />}</SettingsPanel>}
        {section === "subaccount" && <SettingsPanel title="Subaccount setup">{canManageUsers ? <><div className="settings-form-grid"><label>Username<input value={subaccountUsername} onChange={event => setSubaccountUsername(event.target.value)} /></label><label>Password<input type="password" value={subaccountPassword} onChange={event => setSubaccountPassword(event.target.value)} /></label><label>Role<select value={subaccountRole} onChange={event => setSubaccountRole(event.target.value as Role)}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option></select></label><div className="settings-actions"><button onClick={() => void createSubaccount()}>Create subaccount</button></div></div><div className="settings-list">{subaccounts.map(account => <div className="setting-row" key={account.id}><span><b>{account.username}</b><small>{account.role} · {account.is_active === false ? "disabled" : "active"}</small></span><button className="danger-button" onClick={() => void deleteSubaccount(account.id)}>Remove</button></div>)}</div></> : <Unavailable title="Subaccount setup" detail="Administrator role required." />}</SettingsPanel>}
        {section === "user-credentials" && <SettingsPanel title="Username & password"><form className="settings-form-grid" onSubmit={changePassword}><label>Current password<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label><label>New password<input type="password" minLength={8} value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><label>Confirm password<input type="password" minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label><div className="settings-actions"><button className="primary" type="submit">Update password</button></div></form></SettingsPanel>}
        {section === "appearance" && <SettingsPanel title="Appearance"><Choice label="Theme" value={theme} options={[["system", "System"], ["dark", "Dark"], ["light", "Light"]]} onChange={value => applyAppearance(value, density)} /><Choice label="UI density" value={density} options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} onChange={value => applyAppearance(theme, value)} /></SettingsPanel>}
        {section === "accessibility" && <SettingsPanel title="Accessibility"><Toggle label="Reduced motion" checked={reducedMotion} onChange={value => { setReducedMotion(value); document.documentElement.classList.toggle("reduce-motion", value); }} /><Toggle label="High contrast" checked={highContrast} onChange={value => { setHighContrast(value); document.documentElement.classList.toggle("high-contrast", value); }} /><Toggle label="Larger text" checked={largerText} onChange={value => { setLargerText(value); document.documentElement.classList.toggle("large-text", value); }} /><div className="access-note">Keyboard navigation and semantic labels are enabled by default across the interface.</div></SettingsPanel>}
        {section === "sessions" && <SettingsPanel title="Devices & sessions"><p>Sessions are cookie-bound and expire automatically. Revoking sessions signs this account out everywhere.</p><button className="danger-button" onClick={() => void logoutAll()}>Log out all devices</button></SettingsPanel>}
        {section === "sharing" && <SettingsPanel title="Sharing & permissions"><p>Camera sharing is managed per camera in the Sharing section. Operators can manage shared cameras; viewers have read-only access.</p></SettingsPanel>}
        {section === "cameras" && <SettingsPanel title="Cameras"><div className="settings-form-grid"><label>Configured cameras<input value={cameras.length} readOnly /></label><label>Monitored streams<input value={cameras.length} readOnly /></label></div></SettingsPanel>}
        {section === "storage" && <SettingsPanel title="Storage & memory"><p>Storage integrations, capacity, connection status, and per-camera usage are managed in the Storage section.</p><Unavailable title="Local path" detail={runtime?.storage_path ?? "Administrator access required for runtime storage path."} /></SettingsPanel>}
        {section === "ai" && <SettingsPanel title="AI account settings"><p>AI detection status: {metrics ? String(metrics.ai) : "unavailable"}. Model behavior is configured globally, not per account.</p></SettingsPanel>}
        {section === "about" && <SettingsPanel title="About"><div className="about-list"><span>LocalVision AI</span><span>Version {runtime?.version ?? "local build"}</span><span>Environment {runtime?.environment ?? "local"}</span><span>Encrypted secrets {runtime?.secrets_configured ? "configured" : "not configured"}</span></div></SettingsPanel>}
      </section>
    </div>
  </>;
}

function SettingsPanel({ title, children }: { title: string; children: React.ReactNode }) { return <div className="settings-panel"><div className="section-title"><h2>{title}</h2><span>Local configuration</span></div>{children}</div>; }
function Unavailable({ title, detail }: { title: string; detail: string }) { return <div className="unavailable"><b>{title}</b><span>{detail}</span></div>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="toggle-setting"><span>{label}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /></label>; }
function Choice({ label, value, options, onChange }: { label: string; value: string; options: string[][]; onChange: (value: string) => void }) { return <label className="choice-setting"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{options.map(([option, text]) => <option value={option} key={option}>{text}</option>)}</select></label>; }
