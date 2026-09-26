import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';

export function WalletCredential() {
  const [status, setStatus] = useState<{ configured: boolean; required: boolean } | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getWalletConnection().then(setStatus).catch(() => setError('Could not load Wallet security status.'));
  }, []);

  async function changeCredential(revoke: boolean) {
    setBusy(true);
    setError('');
    try {
      if (revoke) {
        await api.revokeWalletCredential();
        setToken('');
      } else {
        const result = await api.createWalletCredential();
        setToken(result.token);
      }
      setStatus(await api.getWalletConnection());
    } catch {
      setError('Could not update your credential. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="font-medium">Protect your Wallet connection</h3>
      {status && (
        <p className="text-sm text-muted">
          {status.required
            ? status.configured ? 'Your Shortcut requires a credential.' : 'Wallet capture is paused until you add a new credential.'
            : 'Your existing Shortcut keeps working during setup. After the first request with a valid credential, all future requests require it.'}
        </p>
      )}
      <p className="text-sm text-muted">
        Generate a credential, then edit the Shortcut’s “Get Contents of URL” action.
        Add a header named Authorization with the value shown below, and run the Shortcut to finish setup.
        Replacing a credential invalidates the previous one.
      </p>
      {token && (
        <div className="space-y-2">
          <label className="text-sm" htmlFor="wallet-authorization">Authorization header — shown only here</label>
          <input id="wallet-authorization" className="input-field w-full font-mono" readOnly value={`Bearer ${token}`} onFocus={event => event.target.select()} />
          <p className="text-xs text-muted">Keep this private. You can generate a replacement if you close this screen before saving it.</p>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" className="min-h-11" disabled={busy || !status} onClick={() => changeCredential(false)}>
          {busy ? 'Updating…' : status?.configured ? 'Replace credential' : 'Generate credential'}
        </Button>
        {status?.configured && (
          <Button variant="outline" className="min-h-11 text-destructive" disabled={busy} onClick={() => changeCredential(true)}>
            Revoke and pause capture
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
