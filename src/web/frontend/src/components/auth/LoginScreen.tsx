import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CasheWordmark, B1_WASH } from '@/components/ui/Brand';
import { m } from 'motion/react';
import { fadeUpVariants } from '@/lib/motionPresets';

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const ok = await login(username, password);
    if (!ok) {
      setError(true);
      setPassword('');
    }
    setLoading(false);
  };

  return (
    <div className="h-dvh overflow-hidden flex items-center justify-center px-4" style={{ background: B1_WASH }}>
      <m.div
        className="relative w-full max-w-sm space-y-8"
        variants={fadeUpVariants}
        initial="initial"
        animate="animate"
      >
        {/* Brand */}
        <div className="flex flex-col items-center gap-3">
          <CasheWordmark size={72} />
          <span className="text-base font-medium text-muted">Cash, caught.</span>
        </div>

        {/* Form card */}
        {/* Login keeps the full brand wash (the one brand moment before sign-in);
            the form floats on it as a frosted surface. */}
        <div className="chrome-frosted rounded-hero p-6 shadow-float">
          <div className="mb-5">
            <h1 className="font-display text-xl font-bold text-foreground">Sign in</h1>
            <p className="mt-0.5 text-sm text-muted">Enter your username and password to continue.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="text"
              aria-label="Username"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
            <Input
              type="password"
              aria-label="Password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">Incorrect username or password.</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !username || !password}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <nav aria-label="Legal" className="flex justify-center gap-4">
          <Button variant="link" size="sm" className="h-auto min-h-11 p-0 text-muted" asChild>
            <Link to="/privacy">Privacy</Link>
          </Button>
          <Button variant="link" size="sm" className="h-auto min-h-11 p-0 text-muted" asChild>
            <Link to="/terms">Terms</Link>
          </Button>
        </nav>
      </m.div>
    </div>
  );
}
