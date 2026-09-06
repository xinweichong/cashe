import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { CasheWordmark, B1_WASH } from '@/components/ui/Brand';
import { motion } from 'framer-motion';
import { fadeUpVariants } from '@/lib/animations';

const taglineStyle: React.CSSProperties = {
  color: 'var(--color-muted)',
  fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
  fontSize: '13px',
  fontWeight: 600,
  letterSpacing: '0.24em',
  lineHeight: 1,
  textTransform: 'uppercase',
};

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
      <motion.div
        className="relative w-full max-w-sm space-y-8"
        variants={fadeUpVariants}
        initial="initial"
        animate="animate"
      >
        {/* Brand */}
        <div className="flex flex-col items-center gap-3">
          <CasheWordmark size={72} />
          <span style={taglineStyle}>CASH, CAUGHT.</span>
        </div>

        {/* Form card */}
        <Card className="p-6 bg-card/80 backdrop-blur-sm border-border/60">
          <div className="mb-5">
            <p className="text-sm font-semibold text-foreground">Sign in.</p>
            <p className="text-xs text-muted mt-0.5">Enter your credentials to continue</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="bg-background border-border"
              autoFocus
              autoComplete="username"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-background border-border"
              autoComplete="current-password"
            />
            {error && (
              <p className="text-sm text-destructive">Incorrect username or password.</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !username || !password}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
