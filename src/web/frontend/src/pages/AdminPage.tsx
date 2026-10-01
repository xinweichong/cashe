import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CasheWordmark } from '@/components/ui/Brand';
import { NavBar } from '@/components/ui/nav-bar';
import { ListGroup, ListRow } from '@/components/ui/list';
import { TaskSheet } from '@/components/ui/task-sheet';
import { DetailHeader } from '@/components/ui/detail-panel';
import { StatusDot } from '@/components/ui/StatusDot';
import { ListDetail } from '@/components/layout/ListDetail';

const ADMIN_BASE = '/admin/api';

async function adminRequest<T>(path: string, opts?: RequestInit, token?: string): Promise<T> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Admin-Token': token } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Error ${res.status}`);
  }
  return res.json();
}

const makeAdminApi = (token: string) => ({
  logout: () =>
    adminRequest<{ status: string }>('/logout', { method: 'POST' }, token),

  listUsers: () =>
    adminRequest<Array<{
      username: string;
      gmail_connected: boolean;
      telegram_linked: boolean;
      onboarding_complete: boolean;
      created_at: string;
    }>>('/users', undefined, token),

  createUser: (username: string) =>
    adminRequest<{ status: string; username: string; password: string; reminder: string }>(
      '/users', { method: 'POST', body: JSON.stringify({ username }) }, token
    ),

  deleteUser: (username: string) =>
    adminRequest<{ status: string }>(`/users/${username}`, { method: 'DELETE' }, token),

  resetPassword: (username: string, new_password: string) =>
    adminRequest<{ status: string }>(`/users/${username}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password }),
    }, token),
});

// Login is unauthenticated — no token needed
const adminLogin = (password: string) =>
  adminRequest<{ status: string; token: string }>('/login', { method: 'POST', body: JSON.stringify({ password }) });

// ── Password generator ────────────────────────────────────────────────────────

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => chars[b % chars.length])
    .join('');
}

function relDate(iso: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

// ── Admin Login ───────────────────────────────────────────────────────────────

function AdminLogin({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { token } = await adminLogin(password);
      onSuccess(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect password');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chrome-wash flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <CasheWordmark size={40} />
          <span className="text-sm font-medium text-muted">Admin</span>
        </div>
        <div className="chrome-frosted rounded-hero p-6 shadow-float">
          <h1 className="mb-4 font-display text-xl font-bold">Sign in to Admin</h1>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="password"
              aria-label="Admin password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="min-h-11 w-full" disabled={loading || !password}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Admin Dashboard ───────────────────────────────────────────────────────────

type User = {
  username: string;
  gmail_connected: boolean;
  telegram_linked: boolean;
  onboarding_complete: boolean;
  created_at: string;
};

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const adminApi = makeAdminApi(token);
  const [users, setUsers] = useState<User[]>([]);
  const [loadError, setLoadError] = useState('');

  // Create user form
  const [newUsername, setNewUsername] = useState('');
  const [createError, setCreateError] = useState('');
  const [createResult, setCreateResult] = useState<{ username: string; password: string; reminder: string } | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadUsers = async () => {
    try {
      const list = await adminApi.listUsers();
      setUsers(list);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Couldn\'t load this — try refreshing.');
    }
  };

  // Fetch on mount only; loadUsers is intentionally excluded from deps (it's
  // redefined every render and is also invoked directly after create/delete).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    setCreateError('');
    setCreateResult(null);
    setCreateLoading(true);
    try {
      const result = await adminApi.createUser(newUsername);
      setCreateResult(result);
      setNewUsername('');
      loadUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Couldn\'t create user — try again.');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    setResetError('');
    setResetLoading(true);
    try {
      await adminApi.resetPassword(resetTarget, resetPassword);
      setResetTarget(null);
      setResetPassword('');
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Couldn\'t reset password — try again.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await adminApi.deleteUser(deleteTarget);
      if (selected === deleteTarget) setSelected(null);
      setDeleteTarget(null);
      loadUsers();
    } catch {
      // ignore
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleLogout = async () => {
    await adminApi.logout().catch(() => {});
    onLogout();
  };

  const copyPassword = (pw: string) => {
    navigator.clipboard.writeText(pw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const selectedUser = users.find((u) => u.username === selected) ?? null;
  const statusLine = (u: User) => [
    u.gmail_connected ? 'Gmail' : 'No Gmail',
    u.telegram_linked ? 'Telegram' : 'No Telegram',
    u.onboarding_complete ? 'Onboarded' : 'Onboarding pending',
  ].join(' · ');
  const yesNo = (on: boolean, yes: string, no: string) => (
    <span className="inline-flex items-center gap-2"><StatusDot tone={on ? 'saved' : 'warm'} />{on ? yes : no}</span>
  );

  // The users list (P4) with each user's detail beside it (P7) or pushed on
  // a phone (P6). Create, reset and delete are task sheets (P5).
  const list = (
    <div>
      <NavBar
        large
        title="Admin"
        trailing={<>
          {/* Icon-only at every size: the list column is narrow even on desktop. */}
          <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 text-teal" aria-label="Add account" title="Add account"
            onClick={() => { setCreateOpen(true); setCreateResult(null); setCreateError(''); }}>
            <Plus aria-hidden className="h-5 w-5" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 text-teal" onClick={handleLogout}>Sign out</Button>
        </>}
      />
      <div className="space-y-3 px-4 pb-8">
        {loadError && <p role="alert" className="px-1 text-sm text-destructive">{loadError}</p>}
        <ListGroup title={`${users.length} ${users.length === 1 ? 'user' : 'users'}`}>
          {users.map((u) => (
            <ListRow
              key={u.username}
              onClick={() => setSelected(selected === u.username ? null : u.username)}
              selected={selected === u.username}
              leading={<span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-fill-press text-xs font-bold">{u.username.charAt(0).toUpperCase()}</span>}
              title={u.username}
              subtitle={statusLine(u)}
              value={relDate(u.created_at)}
            />
          ))}
          {users.length === 0 && <ListRow title="No users" />}
        </ListGroup>
      </div>
    </div>
  );

  const detail = selectedUser && (
    <div className="flex h-full flex-col">
      <DetailHeader title={selectedUser.username} onClose={() => setSelected(null)} />
      <div className="space-y-6 p-4">
        <ListGroup title="Status">
          <ListRow title="Gmail" value={yesNo(selectedUser.gmail_connected, 'Connected', 'Not connected')} />
          <ListRow title="Telegram" value={yesNo(selectedUser.telegram_linked, 'Linked', 'Not linked')} />
          <ListRow title="Onboarding" value={yesNo(selectedUser.onboarding_complete, 'Complete', 'Pending')} />
          <ListRow title="Created" value={relDate(selectedUser.created_at)} />
        </ListGroup>
        <ListGroup>
          <ListRow onClick={() => { setResetTarget(selectedUser.username); setResetPassword(''); setResetError(''); }} title="Reset password" trailing="chevron" />
        </ListGroup>
        <ListGroup footer="Deleting stops all data ingestion for this account. Files are preserved on disk.">
          <ListRow onClick={() => setDeleteTarget(selectedUser.username)} destructive title="Delete account" />
        </ListGroup>
      </div>
    </div>
  );

  return (
    <div className="chrome-wash min-h-dvh">
      <div className="mx-auto max-w-[1200px] md:px-2">
        <ListDetail
          listLabel="Users"
          backLabel="Admin"
          list={list}
          detail={detail}
          onClose={() => setSelected(null)}
          emptyDetail={<p className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">Choose a user to see their status and account actions.</p>}
        />
      </div>

      <TaskSheet
        open={createOpen}
        onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreateResult(null); }}
        title="Add account"
        initialDetent="large"
        dirty={!!newUsername && !createResult}
        confirm={createResult ? { label: 'Done', onClick: () => { setCreateOpen(false); setCreateResult(null); } } : { label: 'Create', onClick: () => void handleCreate(), pending: createLoading, pendingLabel: 'Creating…', disabled: !newUsername }}
      >
        <div className="space-y-3 p-1">
          {!createResult ? <>
            <label htmlFor="admin-new-username" className="px-1 text-sm font-medium">Username</label>
            <Input id="admin-new-username" value={newUsername} onChange={(e) => setNewUsername(e.target.value.toLowerCase())} autoFocus />
            <p className="px-1 text-sm text-muted">A temporary password is generated and shown once.</p>
            {createError && <p role="alert" className="px-1 text-sm text-destructive">{createError}</p>}
          </> : <>
            <p role="status" className="px-1 font-medium text-success">Account created</p>
            <ListGroup footer={createResult.reminder}>
              <ListRow title="Username" value={<span className="font-mono">{createResult.username}</span>} />
              <ListRow title="Temporary password" value={<span className="font-mono">{createResult.password}</span>}
                trailing={<Button type="button" variant="ghost" size="sm" className="text-teal" onClick={() => copyPassword(createResult.password)}>{copied ? 'Copied' : 'Copy'}</Button>} />
            </ListGroup>
          </>}
        </div>
      </TaskSheet>

      <TaskSheet
        open={!!resetTarget}
        onOpenChange={(open) => { if (!open) { setResetTarget(null); setResetPassword(''); setResetError(''); } }}
        title={`Reset password`}
        description={resetTarget ? `New password for ${resetTarget}. At least 8 characters.` : undefined}
        confirm={{ label: 'Reset', onClick: () => void handleReset(), pending: resetLoading, pendingLabel: 'Resetting…', disabled: resetPassword.length < 8 }}
      >
        <div className="space-y-3 p-1">
          <div className="flex gap-2">
            <Input type="text" aria-label="New password" placeholder="New password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} className="flex-1" autoFocus />
            <Button type="button" variant="ghost" className="min-h-11 text-teal" onClick={() => setResetPassword(generatePassword())}>Generate</Button>
          </div>
          {resetError && <p role="alert" className="text-sm text-destructive">{resetError}</p>}
        </div>
      </TaskSheet>

      <TaskSheet open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }} title={`Delete ${deleteTarget ?? ''}?`}>
        <div className="space-y-4 p-1">
          <p className="text-sm text-muted">This stops all data ingestion for this account. Files are preserved on disk.</p>
          <Button type="button" variant="destructive" className="min-h-11 w-full" onClick={() => void handleDelete()} disabled={deleteLoading}>
            {deleteLoading ? 'Deleting…' : 'Delete account'}
          </Button>
        </div>
      </TaskSheet>
    </div>
  );
}

// ── AdminPage: router ─────────────────────────────────────────────────────────

export function AdminPage() {
  const [token, setToken] = useState<string | null>(null);

  if (!token) {
    return (
      <AdminLogin
        onSuccess={(t) => setToken(t)}
      />
    );
  }

  return (
    <AdminDashboard
      token={token}
      onLogout={() => setToken(null)}
    />
  );
}
