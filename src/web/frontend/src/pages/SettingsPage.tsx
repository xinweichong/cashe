import { useState, useEffect, useMemo } from 'react';
import { NavBar } from '@/components/ui/nav-bar';
import { useIsPhone } from '@/hooks/useIsPhone';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { PageCard } from '@/components/ui/cards';
import { CategoryColorPicker, CategoryIconPicker } from '@/components/categories/CategoryPickers';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ListGroup, ListRow } from '@/components/ui/list';
import { TaskSheet } from '@/components/ui/task-sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useAuth } from '@/hooks/useAuthContext';
import { api, type Category, type SessionInfo } from '@/api/client';
import { getCategoryColor } from '@/lib/utils';
import { Plus, CheckCircle2, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { TelegramStep, GmailStep, AppleWalletStep } from '@/components/onboarding/steps';
import { useSettings } from '@/hooks/useSettings';


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
  const navigate = useNavigate();
  const isPhone = useIsPhone();
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
  const [newCatName, setNewCatName] = useState('');
  const [newCatKeywords, setNewCatKeywords] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('📌');
  const [newCatColor, setNewCatColor] = useState('');
  const [editKeywords, setEditKeywords] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editColor, setEditColor] = useState('');
  const [catError, setCatError] = useState('');

  const editingCat = categories?.find((c: Category) => c.name === editingCategory);

  const usedColors = (categories ?? [])
    .filter((c: Category) => c.color)
    .map((c: Category) => c.color!.toLowerCase());

  const startEdit = (cat: Category) => {
    setEditingCategory(cat.name);
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

  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string; description: string; confirmLabel: string; run: () => void;
  } | null>(null);

  const handleDeleteCategory = (name: string) => setPendingConfirm({
    title: `Delete category "${name}"?`,
    description: 'Its transactions will be moved to "Other".',
    confirmLabel: 'Delete category',
    run: () => deleteCat.mutate(name, { onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant-overrides'] }) }),
  });

  const handleDeleteOverride = (merchant: string) => setPendingConfirm({
    title: `Remove learned override for "${merchant}"?`,
    description: 'Future transactions from this merchant will be categorized by keywords again.',
    confirmLabel: 'Remove override',
    run: () => deleteOverride.mutate(merchant),
  });

  // ── Settings (feature toggles + alert thresholds) ───────────────────────────
  const [anomalyMultiplier, setAnomalyMultiplier] = useState<string>('');
  const [velocityThreshold, setVelocityThreshold] = useState<string>('');
  const [settingsError, setSettingsError] = useState('');

  const { data: settings, refetch: refetchSettings } = useSettings();

  // Syncs the editable draft from server data, which arrives asynchronously
  // after mount (and again on refetch) — there's no prop/render-time value to
  // derive this from directly.
  useEffect(() => {
    if (settings) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    key: 'budgets_enabled' | 'goals_enabled' | 'trips_enabled' | 'subscriptions_enabled' | 'recurring_enabled',
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
  const [pwOpen, setPwOpen] = useState(false);

  const handleChangePassword = async () => {
    setPwError('');
    setPwSuccess(false);
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return; }
    if (newPw.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    setPwLoading(true);
    try {
      await api.changePassword(currentPw, newPw);
      setPwSuccess(true);
      setPwOpen(false);
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

  const handleDisconnectGmail = () => setPendingConfirm({
    title: 'Disconnect Gmail?',
    description: 'This stops email ingestion — it\'s gone for good.',
    confirmLabel: 'Disconnect Gmail',
    run: () => void disconnectGmail(),
  });

  const disconnectGmail = async () => {
    setDisconnectingGmail(true);
    try {
      await api.disconnectGmail();
      await invalidateCurrentUser();
    } finally {
      setDisconnectingGmail(false);
    }
  };

  const handleDisconnectTelegram = () => setPendingConfirm({
    title: 'Unlink Telegram?',
    description: 'You will no longer receive transaction notifications.',
    confirmLabel: 'Unlink Telegram',
    run: () => void disconnectTelegram(),
  });

  const disconnectTelegram = async () => {
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
    <div className="mx-auto max-w-[1200px] md:px-2">
      <NavBar large title="Settings" back={isPhone ? { label: 'Back', onClick: () => navigate(-1) } : undefined} />
      {/* A naturally scrolling page in two columns from lg (HIG alignment):
          grouped rows like iOS Settings; editing opens a sheet. */}
      <div className="grid items-start gap-6 px-4 pb-8 lg:grid-cols-2">

      <div className="min-w-0 space-y-6">
        <ListGroup title="Account">
          <ListRow title="Username" value={currentUser?.username ?? '—'} />
          <ListRow title="Change password" trailing="chevron" onClick={() => { setPwOpen(true); setPwSuccess(false); setPwError(''); }} />
        </ListGroup>
        {pwSuccess && <p role="status" className="-mt-4 px-1 text-sm text-success">Password changed.</p>}

        <ListGroup
          title="Signed-in devices"
          footer={sessions && sessions.length > 1 ? undefined : 'Only this device is signed in.'}
        >
          {sessions && sessions.length > 0 ? sessions.map((s) => (
            <ListRow
              key={s.token}
              title={s.user_agent ? parseUserAgent(s.user_agent) : 'Unknown device'}
              subtitle={`Last used ${relativeTime(s.last_used_at)}`}
              trailing={
                <Button
                  variant="ghost" size="sm" className="text-destructive"
                  aria-label={`Sign out ${s.user_agent ? parseUserAgent(s.user_agent) : 'this device'}`}
                  onClick={() => removeSession.mutate(s.token)}
                  disabled={removeSession.isPending}
                >
                  Sign out
                </Button>
              }
            />
          )) : <ListRow title="No signed-in devices" />}
          {sessions && sessions.length > 1 && (
            <ListRow destructive title="Sign out all other devices" onClick={() => logoutAllOthers.mutate()} disabled={logoutAllOthers.isPending} />
          )}
        </ListGroup>

        {activeConnectionStep ? (
          <PageCard title="Connections">
            {activeConnectionStep === 'telegram' && <TelegramStep onComplete={handleConnectionStepComplete} />}
            {activeConnectionStep === 'gmail' && <GmailStep onComplete={handleConnectionStepComplete} />}
            {activeConnectionStep === 'apple_wallet' && <AppleWalletStep onComplete={handleConnectionStepComplete} />}
            <Button variant="ghost" size="sm" className="mt-2 text-muted" onClick={() => setActiveConnectionStep(null)}>
              ← Back
            </Button>
          </PageCard>
        ) : (
          <ListGroup title="Connections">
            <ListRow
              leading={gmailAuthError
                ? <AlertTriangle aria-hidden className="h-5 w-5 text-warning" />
                : currentUser?.gmail_connected
                  ? <CheckCircle2 aria-hidden className="h-5 w-5 text-success" />
                  : <WifiOff aria-hidden className="h-5 w-5 text-muted" />}
              title="Gmail"
              subtitle={gmailAuthError ? 'Sign-in expired — reconnect to keep reading bank emails' : currentUser?.gmail_connected ? 'Connected' : 'Not connected'}
              trailing={gmailAuthError ? (
                <span className="flex gap-1">
                  <Button variant="ghost" size="sm" className="text-teal" onClick={() => setActiveConnectionStep('gmail')}>Reconnect</Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={handleDisconnectGmail} disabled={disconnectingGmail}>Disconnect</Button>
                </span>
              ) : currentUser?.gmail_connected ? (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={handleDisconnectGmail} disabled={disconnectingGmail}>Disconnect</Button>
              ) : (
                <Button variant="ghost" size="sm" className="text-teal" onClick={() => setActiveConnectionStep('gmail')}>Connect</Button>
              )}
            />
            <ListRow
              leading={currentUser?.telegram_chat_id
                ? <CheckCircle2 aria-hidden className="h-5 w-5 text-success" />
                : <WifiOff aria-hidden className="h-5 w-5 text-muted" />}
              title="Telegram"
              subtitle={currentUser?.telegram_chat_id ? 'Linked' : 'Not linked'}
              trailing={currentUser?.telegram_chat_id ? (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={handleDisconnectTelegram} disabled={disconnectingTelegram}>Unlink</Button>
              ) : (
                <Button variant="ghost" size="sm" className="text-teal" onClick={() => setActiveConnectionStep('telegram')}>Link</Button>
              )}
            />
            <ListRow
              leading={<Wifi aria-hidden className="h-5 w-5 text-muted" />}
              title="Apple Wallet"
              subtitle="Sent by an iOS Shortcut when you pay"
              trailing="chevron"
              onClick={() => setActiveConnectionStep('apple_wallet')}
            />
          </ListGroup>
        )}

        <ListGroup title="Account actions">
          <ListRow destructive title="Sign out" onClick={logout} />
        </ListGroup>
      </div>

      <div className="min-w-0 space-y-6">
        <ListGroup
          title="Categories"
          action={
            <Button size="sm" variant="ghost" className="text-teal" onClick={() => { setShowAddCategory(true); setCatError(''); }}>
              <Plus className="mr-1 h-4 w-4" aria-hidden />
              Add
            </Button>
          }
          footer="Needs and wants feed the health score’s 50/30/20 rule: up to 50% of income on needs, 30% on wants, and 20% saved."
        >
          <AnimatePresence>
            {categories?.map((cat: Category) => {
              const learned = overridesByCategory.get(cat.name)?.length ?? 0;
              const keywordCount = cat.keywords?.split(',').filter((k) => k.trim()).length ?? 0;
              return (
                <motion.div key={cat.name} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                  <ListRow
                    leading={
                      <span
                        aria-hidden
                        className="grid h-8 w-8 place-items-center rounded-full text-base"
                        style={{ backgroundColor: `${cat.color || getCategoryColor(cat.name)}33` }}
                      >
                        {cat.icon || '📌'}
                      </span>
                    }
                    title={cat.name}
                    subtitle={[
                      CAT_TYPES.find((t) => t.value === (cat.type ?? 'neutral'))?.label,
                      keywordCount ? `${keywordCount} keyword${keywordCount === 1 ? '' : 's'}` : null,
                      learned ? `${learned} learned merchant${learned === 1 ? '' : 's'}` : null,
                    ].filter(Boolean).join(' · ')}
                    trailing="chevron"
                    onClick={() => startEdit(cat)}
                    aria-label={`Edit ${cat.name}`}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
          {(!categories || categories.length === 0) && <ListRow title="No categories yet" />}
        </ListGroup>

        <div id="feature-toggles">
          <ListGroup title="Features" footer="Turning a feature off hides it; its data is kept.">
            {([
              { key: 'budgets_enabled' as const, label: 'Budgets', desc: 'Spending limits and progress' },
              { key: 'goals_enabled' as const, label: 'Goals', desc: 'Savings targets' },
              { key: 'trips_enabled' as const, label: 'Trips', desc: 'Group spending by trip' },
              { key: 'subscriptions_enabled' as const, label: 'Subscriptions', desc: 'Recurring services and upcoming charges' },
              { key: 'recurring_enabled' as const, label: 'Recurring payments', desc: 'Spot payments that repeat' },
            ]).map(({ key, label, desc }) => (
              <ListRow
                key={key}
                title={label}
                subtitle={desc}
                trailing={<Switch checked={!!settings?.[key]} onCheckedChange={(next) => toggleSetting(key, next)} aria-label={label} />}
              />
            ))}
          </ListGroup>
        </div>

        <ListGroup
          title="Alerts"
          action={<Button type="button" variant="ghost" size="sm" className="text-teal" onClick={saveSettings}>Save</Button>}
          footer={settingsError ? <span className="text-destructive">{settingsError}</span> : undefined}
        >
          <ListRow
            title={<label htmlFor="anomaly-multiplier">Unusual purchase</label>}
            subtitle="Flag a purchase this many times a merchant’s usual amount (1–10)"
            trailing={
              <input
                id="anomaly-multiplier"
                type="number" step="0.1" min="1.0" max="10.0"
                value={anomalyMultiplier}
                onChange={(e) => setAnomalyMultiplier(e.target.value)}
                className="input-field w-20 text-right"
              />
            }
          />
          <ListRow
            title={<label htmlFor="velocity-threshold">Spending pace (%)</label>}
            subtitle="Alert when this month’s pace passes this share of last month (50–300)"
            trailing={
              <input
                id="velocity-threshold"
                type="number" step="1" min="50" max="300"
                value={velocityThreshold}
                onChange={(e) => setVelocityThreshold(e.target.value)}
                className="input-field w-20 text-right"
              />
            }
          />
        </ListGroup>
      </div>

      <TaskSheet
        open={pwOpen}
        onOpenChange={(open) => { setPwOpen(open); if (!open) { setCurrentPw(''); setNewPw(''); setConfirmPw(''); setPwError(''); } }}
        title="Change password"
        dirty={!!(currentPw || newPw || confirmPw)}
        confirm={{ label: 'Save', onClick: () => void handleChangePassword(), pending: pwLoading, pendingLabel: 'Saving…', disabled: !currentPw || !newPw || !confirmPw }}
      >
        <div className="space-y-3 p-1">
          <Input type="password" aria-label="Current password" placeholder="Current password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" />
          <Input type="password" aria-label="New password" placeholder="New password (at least 8 characters)" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          <Input type="password" aria-label="Confirm new password" placeholder="Confirm new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
          {pwError && <p className="text-sm text-destructive">{pwError}</p>}
        </div>
      </TaskSheet>

      <TaskSheet
        open={!!editingCategory}
        onOpenChange={(open) => { if (!open) { setEditingCategory(null); setCatError(''); } }}
        title={editingCategory ?? ''}
        initialDetent="large"
        confirm={{ label: 'Save', onClick: () => editingCategory && handleUpdateCategory(editingCategory), pending: updateCat.isPending, pendingLabel: 'Saving…' }}
      >
        {editingCat && (
          <div className="space-y-4 p-1">
            <div>
              <p className="mb-1 text-xs text-muted">Icon</p>
              <CategoryIconPicker value={editIcon} onChange={setEditIcon} />
            </div>
            <div>
              <label htmlFor="cat-type" className="mb-1 block text-xs text-muted">Type</label>
              <select
                id="cat-type"
                value={editingCat.type ?? 'neutral'}
                onChange={async (e) => {
                  await api.updateCategory(editingCat.name, { type: e.target.value as 'needs' | 'wants' | 'neutral' });
                  qc.invalidateQueries({ queryKey: ['categories'] });
                }}
                className="select-field w-full"
              >
                {CAT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cat-keywords" className="mb-1 block text-xs text-muted">Keywords, separated by commas</label>
              <Input id="cat-keywords" value={editKeywords} onChange={(e) => setEditKeywords(e.target.value)} placeholder="keyword1, keyword2" />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted">Colour</p>
              <CategoryColorPicker
                value={editColor}
                onChange={setEditColor}
                taken={(c) => usedColors.includes(c.toLowerCase()) && editingCat.color?.toLowerCase() !== c.toLowerCase()}
              />
            </div>
            {(overridesByCategory.get(editingCat.name)?.length ?? 0) > 0 && (
              <ListGroup title="Learned merchants" footer="Remove one to let keywords decide its category again.">
                {overridesByCategory.get(editingCat.name)!.map((merchant) => (
                  <ListRow
                    key={merchant}
                    title={merchant}
                    trailing={
                      <Button variant="ghost" size="sm" className="text-destructive" aria-label={`Remove learned merchant ${merchant}`} onClick={() => handleDeleteOverride(merchant)} disabled={deleteOverride.isPending}>
                        Remove
                      </Button>
                    }
                  />
                ))}
              </ListGroup>
            )}
            {catError && <p className="text-sm text-destructive">{catError}</p>}
            <ListGroup>
              <ListRow destructive title="Delete category" onClick={() => { const name = editingCat.name; setEditingCategory(null); handleDeleteCategory(name); }} disabled={deleteCat.isPending} />
            </ListGroup>
          </div>
        )}
      </TaskSheet>

      {/* Add Category Dialog */}
      <Dialog open={showAddCategory} onOpenChange={(open) => { setShowAddCategory(open); if (!open) { setNewCatName(''); setNewCatKeywords(''); setNewCatIcon('📌'); setNewCatColor(''); setCatError(''); } }}>
        <DialogContent>
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
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-muted">Icon</label>
              <div className="mt-1"><CategoryIconPicker value={newCatIcon} onChange={setNewCatIcon} /></div>
            </div>
            <div>
              <label className="text-xs text-muted">Keywords (comma-separated)</label>
              <Input
                value={newCatKeywords}
                onChange={(e) => setNewCatKeywords(e.target.value)}
                placeholder="e.g. clinic, pharmacy, doctor"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Color</label>
              <div className="mt-1"><CategoryColorPicker value={newCatColor} onChange={setNewCatColor} taken={(c) => usedColors.includes(c.toLowerCase())} /></div>
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

      <Dialog open={!!pendingConfirm} onOpenChange={(open) => { if (!open) setPendingConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingConfirm?.title}</DialogTitle>
            <DialogDescription>{pendingConfirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingConfirm(null)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => { pendingConfirm?.run(); setPendingConfirm(null); }}
            >
              {pendingConfirm?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </div>
    </div>
  );
}
