// Exponential backoff with full jitter: attempt 1 → up to 1s, doubling, capped at 60s. Never gives up.
export const backoffDelayMs = (attempt, { baseMs = 1_000, capMs = 60_000, random = Math.random } = {}) => {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2)); // between half the ceiling and the ceiling
};
