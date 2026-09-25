// A short tactile tick confirming a tap registered. Android Chrome honours
// it; iOS Safari has no Vibration API, so there it is silently a no-op and
// the visual press state carries the feedback alone.
export function tapFeedback(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Some embedded browsers throw instead of ignoring the call.
  }
}
