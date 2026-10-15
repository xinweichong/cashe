// Everything the landing page says, in one place. One invented demo month
// (October 2026, "today" is Thu 15 Oct) shared by the phone screens and the
// cards beside them, so every total adds up. Labels follow the app's own
// wording; merchants and amounts are made up.

export const TAGLINE = 'cash, caught.';

export interface Catch {
  id: string;
  /** As it arrives: an alert, a Wallet tap, a Telegram message. */
  raw: string;
  /** What cashe writes down. */
  merchant: string;
  category: string;
  amount: number;
  /** Position in the desktop field, in % of its box, and a slight tilt. */
  x: number;
  y: number;
  tilt: number;
}

/** The hero's loose purchases, caught one at a time. */
export const CATCHES: Catch[] = [
  { id: 'kopi', raw: 'kopi 2.20', merchant: 'Kopi Corner', category: 'Food', amount: 2.2, x: 10, y: 12, tilt: -3 },
  { id: 'fairprice', raw: 'SGD 42.15 at FAIRPRICE', merchant: 'FairPrice', category: 'Shopping', amount: 42.15, x: 50, y: 3, tilt: 2 },
  { id: 'ride', raw: 'ride home $15.99', merchant: 'Ride Hail', category: 'Transport', amount: 15.99, x: 62, y: 28, tilt: -1.5 },
  { id: 'hawker', raw: '/cash 6.52 hawker', merchant: 'Hawker Centre', category: 'Food', amount: 6.52, x: 16, y: 34, tilt: 1.5 },
  { id: 'mrt', raw: 'MRT 2.09', merchant: 'MRT', category: 'Transport', amount: 2.09, x: 44, y: 49, tilt: -4 },
  { id: 'cinema', raw: 'movie tix 25.41', merchant: 'Cinema', category: 'Entertainment', amount: 25.41, x: 3, y: 58, tilt: 2.5 },
  { id: 'streaming', raw: 'Streaming Plus renewed', merchant: 'Streaming Plus', category: 'Bills', amount: 15.98, x: 63, y: 62, tilt: 1 },
  { id: 'paylah', raw: 'PayLah! 5.40 to BOBA', merchant: 'Bubble Tea', category: 'Food', amount: 5.4, x: 24, y: 78, tilt: -2 },
  { id: 'uniqlo', raw: 'Apple Pay · Uniqlo 39.90', merchant: 'Uniqlo', category: 'Shopping', amount: 39.9, x: 66, y: 85, tilt: 3 },
  { id: 'mobile', raw: 'mobile bill due', merchant: 'Mobile Plan', category: 'Bills', amount: 25, x: 34, y: 22, tilt: 4 },
];

export interface TourStep {
  id: 'home' | 'activity' | 'plan' | 'explore';
  label: string;
  title: string;
  body: string;
}

export const TOUR: readonly TourStep[] = [
  { id: 'home', label: 'Home', title: 'Know where the month stands.', body: 'Spending against your budget, where it went and what is coming up, on one screen.' },
  { id: 'activity', label: 'Activity', title: 'Purchases write themselves down.', body: 'Bank alerts, Apple Pay taps and Telegram entries land in one list, already sorted.' },
  { id: 'plan', label: 'Plan', title: 'See the month before it happens.', body: 'A projection for the rest of the month, with every scheduled charge on the way.' },
  { id: 'explore', label: 'Explore', title: 'Find the patterns.', body: 'How spending moves over time, and the purchases that stand out.' },
];

/** The purchase that lands while the tour plays. */
export const NEW_PURCHASE = { merchant: 'Kopi Corner', category: 'Food', time: '2:48 pm', amount: 2.2 };

export const MONTH = {
  name: 'October',
  budget: 2200,
  spentBefore: 1282.2,
  income: 5200,
  vsLast: 54.49,
  toCheck: 2,
  mix: [
    { category: 'Food', amount: 512.3 },
    { category: 'Transport', amount: 248.1 },
    { category: 'Entertainment', amount: 141.39 },
  ],
  comingUp: { merchant: 'Cloud Storage', date: '17 Oct', amount: 3.98 },
  latestBefore: { merchant: 'Hawker Centre', category: 'Food', amount: 6.52 },
};

export const DAYS = [
  {
    day: '15 Oct 2026',
    rows: [
      { merchant: 'Hawker Centre', time: '12:40 pm', category: 'Food', amount: 6.52, note: 'Cash' },
      { merchant: 'MRT', time: '8:12 am', category: 'Transport', amount: 2.09 },
      { merchant: 'Ride Hail', time: '7:55 am', category: 'Transport', amount: 15.99 },
    ],
  },
  {
    day: '14 Oct 2026',
    rows: [
      { merchant: 'MRT', time: '6:59 pm', category: 'Transport', amount: 2.38 },
      { merchant: 'Kopi Corner', time: '6:53 pm', category: 'Food', amount: 5.61 },
      { merchant: 'Cinema', time: '5:26 pm', category: 'Entertainment', amount: 25.41 },
    ],
  },
];

export const PLAN = {
  projection: 1962.4,
  scheduled: 118,
  rest: 560,
  charges: [
    { merchant: 'Cloud Storage', date: '17 Oct', amount: 3.98 },
    { merchant: 'Mobile Plan', date: '22 Oct', amount: 25 },
    { merchant: 'Gym Membership', date: '1 Nov', amount: 89 },
    { merchant: 'Streaming Plus', date: '3 Nov', amount: 15.98 },
  ],
  budgets: [
    { category: 'Food', spent: 512.3, limit: 600 },
    { category: 'Transport', spent: 248.1, limit: 220 },
  ],
  goal: { name: 'Japan trip', saved: 1450, target: 2500, by: 'Dec' },
};

export const EXPLORE = {
  score: 86,
  grade: 'Excellent',
  worth: [
    { merchant: 'Ride Hail', note: '3× its usual', amount: 48.6 },
    { merchant: 'Tiong Bahru Bakery', note: 'First time here', amount: 14.8 },
  ],
  mover: { category: 'Food', change: 96.2 },
  /** Spending per day, 9–15 Oct, for the three biggest categories. */
  series: [
    { category: 'Food', points: [12, 4, 9, 58, 3, 8, 11] },
    { category: 'Transport', points: [4, 18, 6, 4, 22, 5, 18] },
    { category: 'Entertainment', points: [0, 2, 16, 0, 1, 25, 0] },
  ],
};

export const SOURCES = ['DBS PayLah!', 'UOB alerts', 'Apple Pay', 'Telegram'];

/** Evidence demo: the purchases behind a total. One has no rate yet. */
export const EVIDENCE = [
  { merchant: 'Hawker Centre', category: 'Food', amount: 6.52 },
  { merchant: 'Kopi Corner', category: 'Food', amount: 2.2 },
  { merchant: 'Ride Hail', category: 'Transport', amount: 15.99 },
  { merchant: 'MRT', category: 'Transport', amount: 2.09 },
  { merchant: 'Cinema', category: 'Entertainment', amount: 25.41 },
  { merchant: 'Lawson', category: 'Food', amount: null, original: '¥1,200' },
] as const;

export const SETUP = [
  { title: 'Connect Gmail', body: 'cashe reads only the alert emails from the bank senders it is set up for, such as DBS PayLah! and UOB. It never sends, deletes or relabels mail.' },
  { title: 'Add the Apple Pay Shortcut', body: 'An iOS Shortcut sends each Wallet payment as you tap. When the bank email follows, the two become one record.' },
  { title: 'Link Telegram', body: 'For cash and one-offs: /add or /cash with an amount and a merchant. Daily, weekly and monthly summaries arrive there too.' },
];

export const PRINCIPLES = [
  { title: 'Self-hosted.', body: 'cashe runs on its own server, and each person gets a separate database. No advertising, and data is never sold.' },
  { title: 'Gmail, carefully.', body: 'Only alerts from configured bank senders are read, and the inbox is never changed.' },
  { title: 'Shows its working.', body: 'Every total opens the purchases behind it. Anything uncertain is labelled partial or estimated, never guessed.' },
  { title: 'AI is optional.', body: 'Plain-language Telegram entries and daily reads stay off unless the server owner turns them on.' },
];

export const QUESTIONS = [
  {
    id: 'who',
    title: 'Who can use cashe?',
    description: 'People with an invitation. cashe is run privately for a small group, and accounts are created by its owner. There is no public sign-up.',
  },
  {
    id: 'gmail',
    title: 'What does cashe read in my Gmail?',
    description: 'Only messages from the bank and payment senders it is configured for. It takes the amount, currency, merchant and time, and keeps the original message so a purchase can be re-checked. It does not read other mail, and it never sends, deletes or relabels anything.',
  },
  {
    id: 'ai',
    title: 'Does an AI read my spending?',
    description: 'Only if the optional AI features are switched on. Then Google Gemini receives the plain-language messages you send in Telegram and summaries of your spending to write insights. It is never sent Gmail content.',
  },
  {
    id: 'stored',
    title: 'Where is my data kept?',
    description: 'In your own database on cashe\'s server. Passwords are hashed, the site is served only over HTTPS, and off-site backups are encrypted. Data stays until you delete it or ask for your account to be removed.',
  },
];

/** Money as the app shows it: $1,284.40. */
export const money = (n: number): string =>
  `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
