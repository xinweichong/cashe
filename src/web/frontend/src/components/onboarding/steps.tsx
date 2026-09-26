import { WalletCredential } from './WalletCredential';
import { useState, useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';

interface WelcomeStepProps {
  username: string;
  initialWantsGmail: boolean;
  initialWantsAppleWallet: boolean;
  onComplete: (wantsGmail: boolean, wantsAppleWallet: boolean) => void;
}

export function WelcomeStep({
  username,
  initialWantsGmail,
  initialWantsAppleWallet,
  onComplete,
}: WelcomeStepProps) {
  const [wantsGmail, setWantsGmail] = useState(initialWantsGmail);
  const [wantsAppleWallet, setWantsAppleWallet] = useState(initialWantsAppleWallet);
  const [loading, setLoading] = useState(false);

  const handleGetStarted = async () => {
    setLoading(true);
    try {
      await api.setOnboardingPreferences(wantsGmail, wantsAppleWallet);
      onComplete(wantsGmail, wantsAppleWallet);
    } catch {
      // setLoading(false) runs in finally; parent remains on this step
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-mono uppercase tracking-[0.22em] text-muted mb-1">{username}</p>
        <h2 className="text-xl font-semibold text-foreground">Connect your accounts.</h2>
        <p className="text-sm text-muted mt-1">
          cashe can track your spending automatically. Choose how you'd like to connect:
        </p>
      </div>

      <div className="space-y-3">
        <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-foreground/5 transition-colors">
          <input
            type="checkbox"
            checked={wantsGmail}
            onChange={(e) => setWantsGmail(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <div>
            <p className="text-sm font-medium text-foreground">Import Gmail transactions</p>
            <p className="text-xs text-muted mt-0.5">DBS PayLah!, UOB PayNow emails</p>
          </div>
        </label>

        <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-foreground/5 transition-colors">
          <input
            type="checkbox"
            checked={wantsAppleWallet}
            onChange={(e) => setWantsAppleWallet(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <div>
            <p className="text-sm font-medium text-foreground">Import Apple Wallet transactions</p>
            <p className="text-xs text-muted mt-0.5">Tap-to-pay via iOS Shortcut</p>
          </div>
        </label>
      </div>

      <p className="text-xs text-muted">You can connect or change these any time from Settings.</p>

      <div className="flex justify-end">
        <Button onClick={handleGetStarted} disabled={loading}>
          {loading ? 'Saving…' : 'Get Started →'}
        </Button>
      </div>
    </div>
  );
}

// ── Gmail Step ────────────────────────────────────────────────────────────────

interface StepProps {
  onComplete: () => void;
  onSkip?: () => void;
}

export function GmailStep({ onComplete, onSkip }: StepProps) {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, []);

  const handleConnect = async () => {
    setError(null);
    setConnecting(true);
    try {
      const { url } = await api.getOnboardingGmailConnectUrl();
      window.open(url, '_blank');
      // Poll /api/users/me every 2s until gmail_connected = true
      pollRef.current = setInterval(async () => {
        try {
          const user = await api.getCurrentUser();
          if (user.gmail_connected) {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            setConnected(true);
            setConnecting(false);
          }
        } catch {
          // ignore transient errors
        }
      }, 2000);
    } catch {
      setError('Couldn\'t get connect URL — try again.');
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Connect Gmail</h2>
        <p className="text-sm text-muted mt-1">
          Connect your Gmail to import DBS PayLah! and UOB PayNow emails automatically.
        </p>
      </div>

      {connected ? (
        <div className="flex items-center gap-2 text-success text-sm font-medium">
          <CheckCircle2 className="w-4 h-4" />
          Gmail connected
        </div>
      ) : (
        <div className="space-y-3">
          <Button onClick={handleConnect} disabled={connecting}>
            {connecting ? 'Waiting for authorization…' : 'Connect Gmail Account'}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      <div className="flex justify-between">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip} disabled={connecting}>
            Skip for now
          </Button>
        )}
        <Button onClick={onComplete} disabled={connecting} className={onSkip ? '' : 'ml-auto'}>
          Continue →
        </Button>
      </div>
    </div>
  );
}

// ── Telegram Step ─────────────────────────────────────────────────────────────

export function TelegramStep({ onComplete, onSkip }: StepProps) {
  const [token, setToken] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const initStep = async () => {
      try {
        const { token: t } = await api.createTelegramLinkToken();
        setToken(t);
        // Poll until telegram_chat_id is set
        pollRef.current = setInterval(async () => {
          try {
            const user = await api.getCurrentUser();
            if (user.telegram_chat_id !== null) {
              clearInterval(pollRef.current!);
              pollRef.current = null;
              setLinked(true);
            }
          } catch {
            // ignore transient errors
          }
        }, 2000);
      } catch {
        setError('Couldn\'t generate link code — try refreshing.');
      }
    };
    initStep();
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, []);

  const handleCopy = () => {
    if (!token) return;
    navigator.clipboard.writeText(`/start ${token}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Link Telegram</h2>
        <p className="text-sm text-muted mt-1">Get instant transaction alerts on Telegram.</p>
      </div>

      {linked ? (
        <div className="flex items-center gap-2 text-success text-sm font-medium">
          <CheckCircle2 className="w-4 h-4" />
          Telegram linked
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : token ? (
        <div className="space-y-3">
          <ol className="text-sm text-foreground space-y-1 list-decimal list-inside">
            <li>Open the cashe bot: <span className="text-teal font-mono">@cashe_app_bot</span></li>
            <li>Send this code:</li>
          </ol>
          <div className="flex items-center gap-2">
            <div className="flex-1 font-mono text-sm bg-card border border-border rounded-md px-3 py-2 text-foreground">
              /start {token}
            </div>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-xs text-muted">This code expires in 24 hours.</p>
          <p className="text-xs text-muted">Waiting for you to send the code…</p>
        </div>
      ) : (
        <p className="text-sm text-muted">Generating link code…</p>
      )}

      <div className="flex justify-between">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        )}
        <Button onClick={onComplete} className={onSkip ? '' : 'ml-auto'}>
          Continue →
        </Button>
      </div>
    </div>
  );
}

// ── Apple Wallet Step ─────────────────────────────────────────────────────────

const CASHE_SHORTCUT_URL = 'https://www.icloud.com/shortcuts/86350d8fe79c4c1d861eceea80608903';
// Admin: after publishing the updated Shortcut with the Import Question,
// paste the new iCloud link here and rebuild/deploy.

export function AppleWalletStep({ onComplete, onSkip }: StepProps) {
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    api.getWebhookUrl().then(({ url }) => setWebhookUrl(url)).catch(() => {});
  }, []);

  const handleCopyUrl = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Set up Apple Wallet</h2>
        <p className="text-sm text-muted mt-1">
          Capture Apple Wallet transactions automatically via iOS Shortcuts.
        </p>
      </div>

      <div className="space-y-5">
        {/* Step 1 */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">Step 1 of 2 — Install the cashe Shortcut</p>
          <p className="text-sm text-foreground">
            Tap the button to install the cashe Shortcut on your iPhone. When prompted, paste your personal URL below:
          </p>
          {webhookUrl ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 font-mono text-xs bg-card border border-border rounded-md px-3 py-2 text-foreground break-all">
                {webhookUrl}
              </div>
              <Button variant="outline" size="sm" onClick={handleCopyUrl}>
                {copiedUrl ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : (
            <div className="h-9 bg-card border border-border rounded-md animate-pulse" />
          )}
          <Button variant="outline" onClick={() => window.open(CASHE_SHORTCUT_URL, '_blank')}>
            Add cashe Shortcut to iPhone →
          </Button>
        </div>

        <div className="border-t border-border" />

        <WalletCredential />

        {/* Step 2 */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">Step 2 of 2 — Create the automation</p>
          <p className="text-sm text-foreground">
            Once installed, open the Shortcuts app and create the trigger:
          </p>
          <ol className="text-sm text-muted space-y-1 list-decimal list-inside">
            <li>Tap the <span className="text-foreground">Automation</span> tab (bottom of screen)</li>
            <li>Tap <span className="text-foreground">+</span> → New Automation</li>
            <li>Under Personal, tap <span className="text-foreground">Transaction</span></li>
            <li>Select the card(s) you want to track</li>
            <li>Tap Next → Add Action → search <span className="text-foreground">"Run Shortcut"</span></li>
            <li>Select <span className="text-foreground">cashe</span> from the list</li>
            <li>Turn off <span className="text-foreground">"Ask Before Running"</span></li>
            <li>Tap <span className="text-foreground">Done</span></li>
          </ol>
        </div>

        <div className="border-t border-border" />
        <p className="text-sm text-muted">Done — I'll confirm when your first transaction arrives.</p>
      </div>

      <div className="flex justify-between">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Skip
          </Button>
        )}
        <Button onClick={onComplete} className={onSkip ? '' : 'ml-auto'}>
          Done → Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
