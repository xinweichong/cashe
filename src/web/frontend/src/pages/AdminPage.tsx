import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CasheWordmark } from '@/components/ui/Brand';

// ── Admin API client (calls /admin/api/*) ─────────────────────────────────────

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
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3">
          <CasheWordmark size={22} />
        </div>
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-background border-border"
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !password}>
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
        </Card>
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

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CasheWordmark size={22} />
        </div>
        <Button variant="outline" size="sm" onClick={handleLogout}>Sign out</Button>
      </div>

      <div className="max-w-3xl mx-auto space-y-6">
        {/* Create user */}
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Create Account</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
              className="bg-background border-border flex-1"
            />
            <Button onClick={handleCreate} disabled={createLoading || !newUsername}>
              {createLoading ? 'Creating…' : 'Create Account'}
            </Button>
          </div>
          <p className="text-xs text-muted">A temporary password will be generated and shown once.</p>
          {createError && <p className="text-sm text-destructive">{createError}</p>}
          {createResult && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex items-center gap-2 text-success text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Account created
              </div>
              <div className="text-sm space-y-1">
                <p><span className="text-muted">Username:</span> <span className="font-mono">{createResult.username}</span></p>
                <div className="flex items-center gap-2">
                  <span className="text-muted">Password:</span>
                  <span className="font-mono">{createResult.password}</span>
                  <Button variant="outline" size="sm" onClick={() => copyPassword(createResult.password)}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-warning">⚠ {createResult.reminder}</p>
              <Button variant="outline" size="sm" onClick={() => setCreateResult(null)}>
                <X className="w-3.5 h-3.5 mr-1" /> Dismiss
              </Button>
            </div>
          )}
        </Card>

        {/* Users table */}
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Users</h2>
            {loadError && <p className="text-xs text-destructive mt-1">{loadError}</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs text-muted font-medium">Username</th>
                  <th className="text-center p-3 text-xs text-muted font-medium">Gmail</th>
                  <th className="text-center p-3 text-xs text-muted font-medium">Telegram</th>
                  <th className="text-center p-3 text-xs text-muted font-medium">Onboarding</th>
                  <th className="text-left p-3 text-xs text-muted font-medium">Created</th>
                  <th className="text-right p-3 text-xs text-muted font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.username} className="hover:bg-card-hover transition-colors">
                    <td className="p-3 font-mono text-sm text-foreground">{u.username}</td>
                    <td className="p-3 text-center">
                      {u.gmail_connected
                        ? <CheckCircle2 className="w-4 h-4 text-success inline" />
                        : <X className="w-4 h-4 text-muted inline" />}
                    </td>
                    <td className="p-3 text-center">
                      {u.telegram_linked
                        ? <CheckCircle2 className="w-4 h-4 text-success inline" />
                        : <X className="w-4 h-4 text-muted inline" />}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`text-xs ${u.onboarding_complete ? 'text-success' : 'text-muted'}`}>
                        {u.onboarding_complete ? 'Complete' : 'Pending'}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted">{relDate(u.created_at)}</td>
                    <td className="p-3 text-right space-x-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setResetTarget(u.username); setResetPassword(''); setResetError(''); }}
                      >
                        Reset Password
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteTarget(u.username)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted text-sm">No users</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* Reset Password Modal */}
      <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) { setResetTarget(null); setResetPassword(''); setResetError(''); } }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Reset password for {resetTarget}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="New password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="bg-background border-border flex-1"
                autoFocus
              />
              <Button variant="outline" onClick={() => setResetPassword(generatePassword())}>
                Generate
              </Button>
            </div>
            {resetError && <p className="text-sm text-destructive">{resetError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button
                onClick={handleReset}
                disabled={resetLoading || resetPassword.length < 8}
              >
                {resetLoading ? 'Resetting…' : 'Confirm Reset'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Modal */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted">
              This stops all data ingestion for this account. Files are preserved on disk.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button
                className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
                onClick={handleDelete}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting…' : 'Delete Account'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
