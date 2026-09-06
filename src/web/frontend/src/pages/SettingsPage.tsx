import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { PageCard } from '@/components/ui/cards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useMerchantOverrides,
} from '@/hooks/useCategories';
import { useCurrentUser, useInvalidateCurrentUser } from '@/hooks/useCurrentUser';
import { useAuth } from '@/hooks/useAuth';
import { api, type Category, type SessionInfo } from '@/api/client';
import { setCategoryColors, PALETTE, getCategoryColor } from '@/lib/utils';
import { springs, staggerContainerVariants, staggerItemVariants } from '@/lib/animations';
import {
  Pencil, Trash2, Plus, X, ChevronDown,
  CheckCircle2, Wifi, WifiOff, AlertTriangle,
} from 'lucide-react';
import { TelegramStep, GmailStep, AppleWalletStep } from '@/components/onboarding/steps';

const ICON_OPTIONS = [
  '🍜', '🚗', '🛒', '📄', '🎬', '📌', '💰', '🏥', '✈️', '🎓',
  '🏠', '💎', '🎮', '📱', '🏋️', '🎨', '🐾', '🎁', '☕', '🍕',
  '👕', '💊', '🔧', '🎵', '📖', '🌺', '⚡', '🎪', '🌊', '🍀',
];

const CAT_TYPES = [
  { value: 'needs',   label: 'Needs'   },
  { value: 'wants',   label: 'Wants'   },
  { value: 'neutral', label: 'Neutral' },
] as const;

// ── Session helpers ───────────────────────────────────────────────────────────

function parseUserAgent(ua: string): string {
  const browser =
    ua.includes('Safari') && !ua.includes('Chrome') ? 'Safari' :
    ua.includes('Chrome') ? 'Chrome' :
    ua.includes('Firefox') ? 'Firefox' : 'Browser';
  const os =
    ua.includes('iPhone') ? 'iPhone' :
    ua.includes('Mac') ? 'macOS' :
    ua.includes('Windows') ? 'Windows' :
    ua.includes('Android') ? 'Android' : 'Device';
  return `${browser} · ${os}`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsPage() {
  const qc = useQueryClient();
  const { hash } = useLocation();
  const { data: currentUser } = useCurrentUser();
  const invalidateCurrentUser = useInvalidateCurrentUser();
  const { logout } = useAuth();
  const { data: status } = useQuery({ queryKey: ['status'], queryFn: api.getStatus, staleTime: 30_000 });

  const gmailAuthError =
    currentUser?.gmail_connected && status?.gmail?.last_auth_error
      ? status.gmail.last_auth_error
      : null;

  // Smooth-scroll to hash anchor
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  // ── Categories ──────────────────────────────────────────────────────────────
  const { data: categories } = useCategories();
  const { data: overrides } = useMerchantOverrides();
  const createCat = useCreateCategory();
  const updateCat = useUpdateCategory();
  const deleteCat = useDeleteCategory();

  useEffect(() => {
    if (categories) setCategoryColors(categories);
  }, [categories]);

  const deleteOverride = useMutation({
    mutationFn: (merchant: string) => api.deleteMerchantOverride(merchant),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant-overrides'] }),
  });

  const overridesByCategory = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ov of overrides ?? []) {
      map.set(ov.category, [...(map.get(ov.category) ?? []), ov.merchant]);
    }
    return map;
  }, [overrides]);

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatKeywords, setNewCatKeywords] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('📌');
  const [newCatColor, setNewCatColor] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editColor, setEditColor] = useState('');
  const [catError, setCatError] = useState('');

  const usedColors = (categories ?? [])
    .filter((c: Category) => c.color)
    .map((c: Category) => c.color!.toLowerCase());

  const startEdit = (cat: Category) => {
    setEditingCategory(cat.name);
    setExpandedCategory(null);
    setEditKeywords(cat.keywords ?? '');
    setEditIcon(cat.icon ?? '📌');
    setEditColor(cat.color ?? '');
    setCatError('');
  };

  const handleAddCategory = () => {
    if (!newCatName.trim()) return;
    setCatError('');
    createCat.mutate(
      { name: newCatName.trim(), keywords: newCatKeywords.trim() || undefined, icon: newCatIcon, color: newCatColor || undefined },
      {
        onSuccess: () => { setShowAddCategory(false); setNewCatName(''); setNewCatKeywords(''); setNewCatIcon('📌'); setNewCatColor(''); },
        onError: (err: Error) => setCatError(err.message),
      },
    );
  };

  const handleUpdateCategory = (name: string) => {
    setCatError('');
    updateCat.mutate(
      { name, data: { keywords: editKeywords, icon: editIcon, color: editColor || undefined } },
      { onSuccess: () => setEditingCategory(null), onError: (err: Error) => setCatError(err.message) },
    );
  };

  const handleDeleteCategory = (name: string) => {
    if (confirm(`Delete category "${name}"? Transactions will be moved to "Other".`)) {
      deleteCat.mutate(name, { onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant-overrides'] }) });
    }
  };

  const handleDeleteOverride = (merchant: string) => {
    if (confirm(`Remove learned override for "${merchant}"?`)) {
      deleteOverride.mutate(merchant);
    }
  };

  // ── Settings (feature toggles + alert thresholds) ───────────────────────────
  const [anomalyMultiplier, setAnomalyMultiplier] = useState<string>('');
  const [velocityThreshold, setVelocityThreshold] = useState<string>('');
  const [settingsError, setSettingsError] = useState('');

  const { data: settings, refetch: refetchSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  });

  useEffect(() => {
    if (settings) {
      setAnomalyMultiplier(String(settings.anomaly_multiplier));
      setVelocityThreshold(String(settings.velocity_alert_threshold));
    }
  }, [settings]);

  const saveSettings = async () => {
    try {
      setSettingsError('');
      await api.updateSettings({ anomaly_multiplier: parseFloat(anomalyMultiplier), velocity_alert_threshold: parseInt(velocityThreshold) });
      refetchSettings();
    } catch (e: unknown) {
      setSettingsError(e instanceof Error ? e.message : 'Couldn\'t save settings — try refreshing.');
    }
  };

  const toggleSetting = async (
    key: 'budgets_enabled' | 'goals_enabled' | 'trips_enabled' | 'subscriptions_enabled' | 'recurring_enabled' | 'home_briefing_enabled',
    val: boolean,
  ) => {
    await api.updateSettings({ [key]: val });
    refetchSettings();
  };

  // ── Account: change password ────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async () => {
    setPwError('');
    setPwSuccess(false);
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return; }
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    setPwLoading(true);
    try {
      await api.changePassword(currentPw, newPw);
      setPwSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('401') || msg.includes('Current password')) {
        setPwError('Current password is incorrect.');
      } else {
        setPwError('Couldn\'t change password — try again.');
      }
    } finally {
      setPwLoading(false);
    }
  };

  // ── Account: sessions ───────────────────────────────────────────────────────
  const { data: sessions, refetch: refetchSessions } = useQuery<SessionInfo[]>({
    queryKey: ['sessions'],
    queryFn: () => api.listSessions(),
  });

  const removeSession = useMutation({
    mutationFn: (token: string) => api.logoutSession(token),
    onSuccess: () => refetchSessions(),
  });

  const logoutAllOthers = useMutation({
    mutationFn: () => api.logoutAllOtherSessions(),
    onSuccess: () => refetchSessions(),
  });

  // ── Connections ─────────────────────────────────────────────────────────────
  // Which inline connection step is currently open: null | 'telegram' | 'gmail' | 'apple_wallet'
  const [activeConnectionStep, setActiveConnectionStep] = useState<'telegram' | 'gmail' | 'apple_wallet' | null>(null);
  const [disconnectingGmail, setDisconnectingGmail] = useState(false);
  const [disconnectingTelegram, setDisconnectingTelegram] = useState(false);

  const handleDisconnectGmail = async () => {
    if (!confirm('Disconnect Gmail? This stops email ingestion — it\'s gone for good.')) return;
    setDisconnectingGmail(true);
    try {
      await api.disconnectGmail();
      await invalidateCurrentUser();
    } finally {
      setDisconnectingGmail(false);
    }
  };

  const handleDisconnectTelegram = async () => {
    if (!confirm('Unlink Telegram? You will no longer receive transaction notifications.')) return;
    setDisconnectingTelegram(true);
    try {
      await api.disconnectTelegram();
      await invalidateCurrentUser();
    } finally {
      setDisconnectingTelegram(false);
    }
  };

  const handleConnectionStepComplete = async () => {
    setActiveConnectionStep(null);
    await invalidateCurrentUser();
    qc.invalidateQueries({ queryKey: ['status'] });
  };

  return (
    <div className="p-4 space-y-4 md:h-full md:overflow-hidden md:grid md:gap-4 md:p-6 md:space-y-0 page-grid-settings">

      {/* ── Title ── */}
      <div className="area-title">
        <div className="flex flex-col gap-1 pb-5 border-b border-border">
          <div className="text-xs uppercase tracking-[0.22em] text-muted font-mono font-semibold">
            Settings
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground font-display">
            Your preferences.
          </h1>
        </div>
      </div>

      {/* ── LEFT PANEL: Account + Connections ── */}
      <div className="area-left grid-scroll-panel space-y-4">

        {/* Account */}
        <PageCard title="Account">
          <div className="space-y-5">
            {/* Username display */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Username</span>
              <span className="text-sm font-medium text-foreground">{currentUser?.username ?? '—'}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={logout}
            >
              Sign out
            </Button>

            <Separator />

            {/* Change password */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">Change Password</p>
              <Input
                type="password"
                placeholder="Current password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="bg-background border-border"
                autoComplete="current-password"
              />
              <Input
                type="password"
                placeholder="New password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="bg-background border-border"
                autoComplete="new-password"
              />
              <Input
                type="password"
                placeholder="Confirm new password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                className="bg-background border-border"
                autoComplete="new-password"
              />
              {pwError && <p className="text-sm text-destructive">{pwError}</p>}
              {pwSuccess && <p className="text-sm text-success">Password changed successfully.</p>}
              <Button
                size="sm"
                onClick={handleChangePassword}
                disabled={pwLoading || !currentPw || !newPw || !confirmPw}
              >
                {pwLoading ? 'Saving…' : 'Change Password'}
              </Button>
            </div>

            <Separator />

            {/* Active sessions */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-foreground">Active Sessions</p>
              {sessions && sessions.length > 0 ? (
                <>
                  <div className="space-y-1">
                    {sessions.map((s) => (
                      <div key={s.token} className="flex items-center justify-between py-1.5">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">
                            {s.user_agent ? parseUserAgent(s.user_agent) : 'Unknown device'}
                          </p>
                          <p className="text-xs text-muted">{relativeTime(s.last_used_at)}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive shrink-0"
                          onClick={() => removeSession.mutate(s.token)}
                          disabled={removeSession.isPending}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  {sessions.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted hover:text-foreground"
                      onClick={() => logoutAllOthers.mutate()}
                      disabled={logoutAllOthers.isPending}
                    >
                      Log out all other devices
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted">No active sessions</p>
              )}
            </div>
          </div>
        </PageCard>

        {/* Connections */}
        {activeConnectionStep ? (
          <PageCard title="Connections">
            {activeConnectionStep === 'telegram' && (
              <TelegramStep onComplete={handleConnectionStepComplete} />
            )}
            {activeConnectionStep === 'gmail' && (
              <GmailStep onComplete={handleConnectionStepComplete} />
            )}
            {activeConnectionStep === 'apple_wallet' && (
              <AppleWalletStep onComplete={handleConnectionStepComplete} />
            )}
            <Button variant="ghost" size="sm" className="mt-2 text-muted" onClick={() => setActiveConnectionStep(null)}>
              ← Back
            </Button>
          </PageCard>
        ) : (
          <PageCard title="Connections">
            <div className="divide-y divide-border">
              {/* Gmail */}
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2 min-w-0">
                  {gmailAuthError ? (
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                  ) : currentUser?.gmail_connected ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-muted shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Gmail</p>
                    <p className={gmailAuthError ? 'text-xs font-mono truncate text-warning' : 'text-xs text-muted font-mono'}>
                      {gmailAuthError ? 'Auth error — reconnect required' : currentUser?.gmail_connected ? 'Connected' : 'Not connected'}
                    </p>
                  </div>
                </div>
                {gmailAuthError ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      className="shrink-0"
                      onClick={() => setActiveConnectionStep('gmail')}
                    >
                      Reconnect
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-destructive"
                      onClick={handleDisconnectGmail}
                      disabled={disconnectingGmail}
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : currentUser?.gmail_connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={handleDisconnectGmail}
                    disabled={disconnectingGmail}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setActiveConnectionStep('gmail')}
                  >
                    Connect
                  </Button>
                )}
              </div>

              {/* Telegram */}
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2 min-w-0">
                  {currentUser?.telegram_chat_id ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-muted shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Telegram</p>
                    <p className="text-xs text-muted font-mono">
                      {currentUser?.telegram_chat_id ? 'Linked' : 'Not linked'}
                    </p>
                  </div>
                </div>
                {currentUser?.telegram_chat_id ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={handleDisconnectTelegram}
                    disabled={disconnectingTelegram}
                  >
                    Unlink
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setActiveConnectionStep('telegram')}
                  >
                    Link Telegram
                  </Button>
                )}
              </div>

              {/* Apple Wallet */}
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Wifi className="w-4 h-4 text-muted shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Apple Wallet</p>
                    <p className="text-xs text-muted font-mono">Passive — via iOS Shortcut</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setActiveConnectionStep('apple_wallet')}
                >
                  Set up →
                </Button>
              </div>
            </div>
          </PageCard>
        )}

      </div>

      {/* ── RIGHT PANEL: Categories + Preferences ── */}
      <div className="area-right grid-scroll-panel space-y-4">

        {/* Categories */}
        <Card className="border-border">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h2 className="font-medium">Categories</h2>
            <Button size="sm" variant="ghost" onClick={() => { setShowAddCategory(true); setCatError(''); }}>
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
          <motion.div
            className="divide-y divide-border"
            variants={staggerContainerVariants}
            initial="initial"
            animate="animate"
          >
            <AnimatePresence>
              {categories?.map((cat: Category) => (
                <motion.div
                  key={cat.name}
                  className="px-4 py-3"
                  variants={staggerItemVariants}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                >
                  {editingCategory === cat.name ? (
                    <div className="space-y-3">
                      <div className="shrink-0">
                        <label className="text-xs text-muted block mb-1">Icon</label>
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {ICON_OPTIONS.map((ic) => (
                            <button
                              key={ic}
                              type="button"
                              className={`w-7 h-7 rounded text-sm flex items-center justify-center border transition-colors ${editIcon === ic ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent'}`}
                              onClick={() => setEditIcon(ic)}
                            >
                              {ic}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Keywords (comma-separated)</label>
                        <Input
                          value={editKeywords}
                          onChange={(e) => setEditKeywords(e.target.value)}
                          placeholder="keyword1, keyword2"
                          className="bg-background border-border text-sm"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted">Color</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {PALETTE.map((c) => {
                            const taken = usedColors.includes(c.toLowerCase()) && (cat.color?.toLowerCase() !== c.toLowerCase());
                            return (
                              <motion.button
                                key={c}
                                type="button"
                                disabled={taken}
                                title={taken ? 'Already in use' : c}
                                className={`w-7 h-7 rounded-full border-2 transition-colors ${editColor === c ? 'border-white' : 'border-transparent'} ${taken ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                                style={{ backgroundColor: c }}
                                onClick={() => setEditColor(c)}
                                animate={{ scale: editColor === c ? 1.1 : 1 }}
                                whileHover={taken ? {} : { scale: editColor === c ? 1.1 : 1.05 }}
                                transition={springs.snappy}
                              />
                            );
                          })}
                        </div>
                      </div>
                      {catError && <p className="text-xs text-destructive">{catError}</p>}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleUpdateCategory(cat.name)} disabled={updateCat.isPending}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditingCategory(null); setCatError(''); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: cat.color || getCategoryColor(cat.name) }}
                          />
                          <span className="text-lg shrink-0">{cat.icon || '📌'}</span>
                          <span className="text-sm font-medium truncate">{cat.name}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(cat)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                            onClick={() => handleDeleteCategory(cat.name)}
                            disabled={deleteCat.isPending}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 ml-7">
                        <label className="text-xs text-muted">Type</label>
                        <select
                          value={cat.type ?? 'neutral'}
                          onChange={async (e) => {
                            await api.updateCategory(cat.name, { type: e.target.value as 'needs' | 'wants' | 'neutral' });
                            qc.invalidateQueries({ queryKey: ['categories'] });
                          }}
                          className="select-field text-xs py-0.5 h-7"
                        >
                          {CAT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      {cat.keywords?.trim() && (
                        <div className="flex flex-wrap gap-1 mt-1.5 ml-7">
                          {cat.keywords.split(',').map((kw) => (
                            <Badge key={kw.trim()} variant="outline" className="text-xs border-border">
                              {kw.trim()}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {(overridesByCategory.get(cat.name)?.length ?? 0) > 0 && (
                        <div className="mt-1.5 ml-7">
                          <button
                            type="button"
                            onClick={() => setExpandedCategory(expandedCategory === cat.name ? null : cat.name)}
                            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-border text-muted hover:text-foreground hover:border-foreground/50 transition-colors"
                          >
                            <span>{overridesByCategory.get(cat.name)!.length} learned</span>
                            <ChevronDown className={`w-3 h-3 transition-transform ${expandedCategory === cat.name ? 'rotate-180' : ''}`} />
                          </button>
                          {expandedCategory === cat.name && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {overridesByCategory.get(cat.name)!.map((merchant) => (
                                <span key={merchant} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-border bg-card">
                                  {merchant}
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteOverride(merchant)}
                                    disabled={deleteOverride.isPending}
                                    className="text-muted hover:text-destructive transition-colors"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {(!categories || categories.length === 0) && (
              <div className="p-6 text-center text-muted text-sm">No categories yet</div>
            )}
          </motion.div>
        </Card>

        {/* Feature Toggles */}
        <div id="feature-toggles">
          <PageCard title="Feature Toggles">
            <div className="divide-y divide-border">
              {([
                { key: 'home_briefing_enabled' as const, label: 'Home briefing', desc: 'Try the new spending briefing as your start page' },
                { key: 'budgets_enabled' as const, label: 'Budgets', desc: 'Set spending limits and track progress' },
                { key: 'goals_enabled' as const, label: 'Goals', desc: 'Track savings targets and monthly progress' },
                { key: 'trips_enabled' as const, label: 'Trips', desc: 'Group transactions by trip and track travel spend' },
                { key: 'subscriptions_enabled' as const, label: 'Subscriptions', desc: 'Track recurring services and upcoming charges' },
                { key: 'recurring_enabled' as const, label: 'Recurring Transactions', desc: 'Detect and surface repeating transaction patterns' },
              ]).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{label}</p>
                    <p className="text-xs text-muted font-mono">{desc}</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={!!settings?.[key]}
                    aria-label={label}
                    onClick={() => toggleSetting(key, !settings?.[key])}
                    className={`relative w-10 h-5 rounded-full transition-colors ${settings?.[key] ? 'toggle-on' : 'bg-foreground/20'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings?.[key] ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              ))}
            </div>
          </PageCard>
        </div>

        {/* Alert Thresholds */}
        <PageCard title="Alert Thresholds">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Anomaly Detection Multiplier</label>
              <p className="text-xs text-muted mb-1">Flag transactions exceeding Nx the category average (1.0–10.0)</p>
              <input
                type="number" step="0.1" min="1.0" max="10.0"
                value={anomalyMultiplier}
                onChange={(e) => setAnomalyMultiplier(e.target.value)}
                className="input-field w-32"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Velocity Alert Threshold (%)</label>
              <p className="text-xs text-muted mb-1">Alert when monthly pace exceeds X% of last month (50–300)</p>
              <input
                type="number" step="1" min="50" max="300"
                value={velocityThreshold}
                onChange={(e) => setVelocityThreshold(e.target.value)}
                className="input-field w-32"
              />
            </div>
            <button onClick={saveSettings} className="btn-action">Save</button>
            {settingsError && <p className="text-sm text-destructive mt-1">{settingsError}</p>}
          </div>
        </PageCard>

      </div>

      {/* Add Category Dialog */}
      <Dialog open={showAddCategory} onOpenChange={(open) => { setShowAddCategory(open); if (!open) { setNewCatName(''); setNewCatKeywords(''); setNewCatIcon('📌'); setNewCatColor(''); setCatError(''); } }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Add Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted">Name</label>
              <Input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="e.g. Healthcare"
                className="bg-background border-border"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-muted">Icon</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    className={`w-7 h-7 rounded text-sm flex items-center justify-center border transition-colors ${newCatIcon === ic ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-accent'}`}
                    onClick={() => setNewCatIcon(ic)}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted">Keywords (comma-separated)</label>
              <Input
                value={newCatKeywords}
                onChange={(e) => setNewCatKeywords(e.target.value)}
                placeholder="e.g. clinic, pharmacy, doctor"
                className="bg-background border-border"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Color</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {PALETTE.map((c) => {
                  const taken = usedColors.includes(c.toLowerCase());
                  return (
                    <motion.button
                      key={c}
                      type="button"
                      disabled={taken}
                      title={taken ? 'Already in use' : c}
                      className={`w-7 h-7 rounded-full border-2 transition-colors ${newCatColor === c ? 'border-white' : 'border-transparent'} ${taken ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setNewCatColor(c)}
                      animate={{ scale: newCatColor === c ? 1.1 : 1 }}
                      whileHover={taken ? {} : { scale: newCatColor === c ? 1.1 : 1.05 }}
                      transition={springs.snappy}
                    />
                  );
                })}
              </div>
            </div>
            {catError && <p className="text-xs text-destructive">{catError}</p>}
            <Separator />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddCategory(false)}>Cancel</Button>
              <Button onClick={handleAddCategory} disabled={!newCatName.trim() || createCat.isPending}>Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
