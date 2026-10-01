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

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div className="space-y-1">
      <label htmlFor={id} className="px-1 text-sm font-medium text-foreground">{label}</label>
      <input id={id} type="password" value={value} onChange={e => set(e.target.value)} className="input-field w-full" autoComplete={autoComplete} required />
    </div>
  );

  return (
    <div className="chrome-wash flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 px-1">
          <h1 className="font-display text-large-title font-extrabold tracking-[-0.02em] text-foreground">Set your password</h1>
          <p className="text-muted">Your account was created with a temporary password. Set a new one to continue.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-group bg-card p-4">
          {field('set-password-current', 'Temporary password', current, setCurrent, 'current-password')}
          {field('set-password-new', 'New password', next, setNext, 'new-password')}
          {field('set-password-confirm', 'Confirm new password', confirm, setConfirm, 'new-password')}

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={saving} className="min-h-11 w-full">
            {saving ? 'Saving…' : 'Set password'}
          </Button>
        </form>
      </div>
    </div>
  );
}
