import { useHomeBriefing } from './useBriefing';

// How many things are waiting to be checked: capture and follow-up issues,
// unresolved spending records, records needing review, and recurring
// suggestions. Shares Home's briefing query, so the tab bar and sidebar
// badges agree with Home's "to check" count. Undefined until loaded.
export function useAttentionCount(): number | undefined {
  const { data } = useHomeBriefing();
  if (!data) return undefined;
  const unresolved = data.facts.current.unresolved_count + data.facts.undated_count;
  return data.capture_issue_count + data.followup_issue_count + unresolved + data.review_count + data.recurring_suggestion_count;
}
