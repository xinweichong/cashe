export type SubscriptionConfirmation = 'unknown' | 'user' | 'recurring_suggestion';

export const subscriptionConfirmationLabels: Record<SubscriptionConfirmation, string> = {
  unknown: 'Schedule confirmation not recorded',
  user: 'Schedule confirmed by you',
  recurring_suggestion: 'Recurring pattern confirmed by you',
};
