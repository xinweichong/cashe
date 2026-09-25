import { describe, expect, test } from 'vitest';

// Guards the shared-UI consolidation (docs/plans/2026-09-17-cashe-production-
// experience-polish.md, U20). It flags regressions for review rather than
// banning native elements: native <button>s remain legitimate inside approved
// special controls, so each file's current reviewed count is recorded below.
// Raising a count means a new native command — reuse Button, or record the
// approved special control here with the reason.

const sources = import.meta.glob<string>(['../**/*.tsx', '../**/*.ts', '!../**/__tests__/**', '!../dev/**'], {
  query: '?raw', import: 'default', eager: true,
});

const UI_OWNERS = /\/components\/ui\//;

// file → reviewed native <button> count and the owner/approval that covers it
const NATIVE_BUTTONS: Record<string, [number, string]> = {
  'components/transactions/TransactionFilters.tsx': [5, 'U04 type/review/category/quick-date filter pills (approval-gated)'],
  'pages/SettingsPage.tsx': [3, 'U19 icon/colour pickers, override chip remove (approval-gated)'],
  'components/subscriptions/SubscriptionsSection.tsx': [3, 'U13 selectable subscription rows (approval-gated)'],
  'components/charts/CategoryDonut.tsx': [3, 'U13 legend rows (approval-gated)'],
  'pages/PlanPage.tsx': [2, 'U19 calendar and week-strip day cells (retained role)'],
  'components/transactions/TransactionDetail.tsx': [2, 'U04 quick category pills, U13 purchase candidates (approval-gated)'],
  'pages/OverviewPage.tsx': [1, 'period chips (classic, retained)'],
  'pages/MerchantsPage.tsx': [1, 'U04 tag filter (approval-gated)'],
  'pages/ExplorePatternsPage.tsx': [1, 'U04 category choice pills (approval-gated)'],
  'components/merchants/MerchantProfile.tsx': [1, 'U04 tag toggles (approval-gated)'],
  'components/charts/CategoryChangeBars.tsx': [1, 'CategoryChangeBarRow owner (approved row)'],
};

const files = Object.entries(sources).map(([path, text]) => [path.replace(/^\.\.\//, ''), text] as const);

function offenders(pattern: RegExp, include: (path: string) => boolean = () => true) {
  return files.filter(([path, text]) => include(path) && pattern.test(text)).map(([path]) => path);
}

describe('shared UI inventory', () => {
  test('the removed .btn-action utility is not reintroduced', () => {
    expect(offenders(/\bbtn-action\b/)).toEqual([]);
  });

  test('the Radix accent compat token is not used as a visible colour outside UI owners', () => {
    expect(offenders(/\b(text|bg|border)-accent\b/, (p) => !UI_OWNERS.test('/' + p))).toEqual([]);
  });

  test('confirmations compose Dialog instead of the browser confirm()', () => {
    expect(offenders(/(^|[^\w.])(window\.)?confirm\(/m)).toEqual([]);
  });

  test('overlays use the owner backdrop, not ad-hoc black scrims', () => {
    expect(offenders(/\bbg-black\//, (p) => !UI_OWNERS.test('/' + p) && !p.endsWith('TransactionsPage.tsx'))).toEqual([]);
  });

  test('native <button> counts match the reviewed allowlist', () => {
    const counts = Object.fromEntries(
      files
        .filter(([path]) => !UI_OWNERS.test('/' + path))
        .map(([path, text]) => [path, (text.match(/<button\b/g) ?? []).length] as const)
        .filter(([, count]) => count > 0),
    );
    const allowed = Object.fromEntries(Object.entries(NATIVE_BUTTONS).map(([path, [count]]) => [path, count]));
    expect(counts).toEqual(allowed);
  });
});
