import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

interface AuthContextType {
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);

// Broadcasts a logout/expiry to other tabs sharing this browser profile.
const AUTH_BROADCAST_KEY = 'cashe-auth-generation';

function clearPrivateCache(queryClient: ReturnType<typeof useQueryClient>) {
  // Cancel first so a response that resolves after this point cannot
  // repopulate the cache for whichever user is authenticated next.
  queryClient.cancelQueries();
  queryClient.clear();
}

function broadcastLogout() {
  try {
    window.localStorage.setItem(AUTH_BROADCAST_KEY, String(Date.now()));
  } catch {
    // Private-mode/storage-disabled browsers still deauthenticate locally.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    api.ping()
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handler = () => {
      clearPrivateCache(queryClient);
      setIsAuthenticated(false);
      broadcastLogout();
    };
    window.addEventListener('auth:unauthorized', handler);
    return () => window.removeEventListener('auth:unauthorized', handler);
  }, [queryClient]);

  // Another tab logged out or hit a 401 — follow suit here too.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== AUTH_BROADCAST_KEY) return;
      clearPrivateCache(queryClient);
      setIsAuthenticated(false);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [queryClient]);

  const login = async (username: string, password: string) => {
    try {
      // Defensive: guarantee no residue from a previous session's cache.
      clearPrivateCache(queryClient);
      await api.login(username, password);
      setIsAuthenticated(true);
      return true;
    } catch {
      return false;
    }
  };

  const logout = () => {
    clearPrivateCache(queryClient);
    setIsAuthenticated(false);
    broadcastLogout();
    api.logout().catch(() => {});  // best-effort; ignore errors
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
