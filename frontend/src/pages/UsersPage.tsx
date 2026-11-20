import { useEffect, useState } from "react";
import { userApi } from "../services/api";
import type { UserInput } from "../services/api";
import type { Role, UserRecord } from "../types/auth";

interface Props { currentUser: { id: number; username: string; role: Role }; }

const permissionKeys = [
  "cameras.view", "cameras.manage", "zones.manage", "recordings.view", "events.view", "alerts.view", "alerts.manage", "sharing.manage", "storage.manage", "integrations.manage", "system.view", "users.manage",
];

const permissionLabels: Record<string, string> = {
  "cameras.view": "View cameras",
  "cameras.manage": "Manage cameras",
  "zones.manage": "Manage AI zones",
  "recordings.view": "View recordings",
  "events.view": "View events",
  "alerts.view": "View alerts",
  "alerts.manage": "Acknowledge alerts",
  "sharing.manage": "Share cameras",
  "storage.manage": "Manage storage",
  "integrations.manage": "Manage integrations",
  "system.view": "View system health",
  "users.manage": "Manage users",
};

const roleDefaults: Record<Role, Record<string, boolean>> = {
  admin: Object.fromEntries(permissionKeys.map(key => [key, true])),
  operator: { "cameras.view": true, "cameras.manage": true, "zones.manage": true, "recordings.view": true, "events.view": true, "alerts.view": true, "alerts.manage": true, "sharing.manage": true, "storage.manage": false, "integrations.manage": false, "system.view": true, "users.manage": false },
  viewer: { "cameras.view": true, "recordings.view": true, "events.view": true, "alerts.view": true },
};

const emptyForm: UserInput = { username: "", password: "", role: "viewer", permissions: roleDefaults.viewer, is_active: true };

export function UsersPage({ currentUser }: Props) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [form, setForm] = useState<UserInput>(emptyForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setUsers(await userApi.list());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load users");
    }
  };

  useEffect(() => { void load(); }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setEditing(null);
    setShowForm(true);
    setError("");
  };

  const openEdit = (record: UserRecord) => {
    setForm({ username: record.username, password: "", role: record.role as Role, permissions: { ...roleDefaults[record.role as Role], ...(record.permissions ?? {}) }, is_active: record.is_active ?? true });
    setEditing(record.id);
    setShowForm(true);
    setError("");
  };

  const setRole = (role: Role) => {
    setForm(current => ({ ...current, role, permissions: { ...roleDefaults[role] } }));
  };

  const togglePermission = (key: string) => {
    setForm(current => ({ ...current, permissions: { ...(current.permissions ?? {}), [key]: !current.permissions?.[key] } }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload: Partial<UserInput> = { username: form.username, role: form.role, permissions: form.permissions, is_active: form.is_active };
      if (form.password) payload.password = form.password;
      if (editing) await userApi.update(editing, payload);
      else await userApi.create({ ...payload, password: form.password ?? "" } as UserInput);
      setShowForm(false);
      setNotice(editing ? "Account updated" : "Account created");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save account");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (record: UserRecord) => {
    if (record.id === currentUser.id) {
      setError("You cannot delete your own account");
      return;
    }
    if (!window.confirm(`Delete ${record.username}?`)) return;
    try {
      await userApi.remove(record.id);
      setNotice("Account deleted");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete account");
    }
  };

  const revoke = async (record: UserRecord) => {
    try {
      await userApi.revokeSessions(record.id);
      setNotice(`Sessions revoked for ${record.username}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke sessions");
    }
  };

  const activeCount = users.filter(user => user.is_active !== false).length;
  const adminCount = users.filter(user => user.role === "admin").length;
  const operatorCount = users.filter(user => user.role === "operator").length;

  return <>
    <div className="page-heading"><div><span className="eyebrow">Administration / users</span><h1>User management</h1><p>Create accounts, assign roles and permissions, and control active sessions.</p></div><button className="primary" onClick={openCreate}>Add account</button></div>
    {notice && <div className="notice inline-notice" role="status" onClick={() => setNotice("")}>{notice} <b>×</b></div>}
    {error && <div className="error-state" role="alert">{error}</div>}
    <div className="metrics">
      <div><small>Total accounts</small><b>{users.length}</b><span>registered users</span></div>
      <div><small>Active accounts</small><b>{activeCount}</b><span>can sign in</span></div>
      <div><small>Administrators</small><b>{adminCount}</b><span>full access</span></div>
      <div><small>Operators</small><b>{operatorCount}</b><span>camera access</span></div>
    </div>
    <section className="settings-panel">
      <div className="section-title"><h2>Accounts</h2><span>Individual credentials · role-based access</span></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Permissions</th><th>Created</th><th>Actions</th></tr></thead><tbody>
        {users.map(record => {
          const granted = permissionKeys.filter(key => (record.permissions?.[key] ?? roleDefaults[record.role as Role]?.[key] ?? false) || record.role === "admin");
          return <tr key={record.id}><td><b>{record.username}</b><small>#{record.id}{record.id === currentUser.id ? " · you" : ""}</small></td><td><span className={`role-pill role-${record.role}`}>{record.role}</span></td><td><span className={`storage-status ${record.is_active === false ? "status-offline" : "status-online"}`}>{record.is_active === false ? "disabled" : "active"}</span></td><td><div className="permission-tags">{granted.slice(0, 4).map(key => <span key={key}>{permissionLabels[key] ?? key}</span>)}{granted.length > 4 && <span>+{granted.length - 4}</span>}</div></td><td>{new Date(record.created_at).toLocaleDateString()}</td><td><div className="table-actions"><button onClick={() => openEdit(record)}>Edit</button><button onClick={() => void revoke(record)}>Revoke sessions</button>{record.id !== currentUser.id && <button onClick={() => void remove(record)}>Delete</button>}</div></td></tr>;
        })}
        {!users.length && <tr><td colSpan={6}>No accounts found.</td></tr>}
      </tbody></table></div>
    </section>
    {showForm && <div className="modal-backdrop"><form className="camera-form" onSubmit={save}>
      <div className="form-heading"><div><span className="eyebrow">User account</span><h2>{editing ? "Edit account" : "Create account"}</h2></div><button type="button" className="close-button" onClick={() => setShowForm(false)}>×</button></div>
      <div className="form-grid">
        <label>Username<input required value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value }))} /></label>
        <label>Password<input type="password" minLength={editing ? undefined : 8} required={!editing} placeholder={editing ? "Leave blank to keep current" : "At least 8 characters"} value={form.password ?? ""} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} /></label>
        <label>Role<select value={form.role} onChange={event => setRole(event.target.value as Role)}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
        <label className="toggle-setting"><span>Account enabled</span><input type="checkbox" checked={form.is_active} onChange={event => setForm(current => ({ ...current, is_active: event.target.checked }))} /></label>
      </div>
      <div className="permission-grid">{permissionKeys.map(key => <label key={key}><input type="checkbox" checked={Boolean(form.permissions?.[key])} onChange={() => togglePermission(key)} />{permissionLabels[key] ?? key}</label>)}</div>
      <div className="form-actions"><button type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary" disabled={busy} type="submit">{busy ? "Saving…" : editing ? "Save changes" : "Create account"}</button></div>
    </form></div>}
  </>;
}
