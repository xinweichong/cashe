import { useState } from 'react';
import { api } from '@/api/client';
import { useInvalidateCurrentUser } from '@/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';

export function SetPasswordPage() {
  const invalidateCurrentUser = useInvalidateCurrentUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(current, next);
      await invalidateCurrentUser();
    } catch {
      setError('Current password is incorrect.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">Set your password</h1>
          <p className="text-sm text-muted">
            Your account was created with a temporary password. Set a new one to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted">Temporary password</label>
            <input
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              className="input-field w-full"
              autoComplete="current-password"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted">New password</label>
            <input
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              className="input-field w-full"
              autoComplete="new-password"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted">Confirm new password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="input-field w-full"
              autoComplete="new-password"
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'Saving…' : 'Set password'}
          </Button>
        </form>
      </div>
    </div>
  );
}
