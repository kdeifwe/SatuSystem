export const DEFAULT_DURATION_MINUTES = 60;
export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 240;

/**
 * Returns the appointment duration in minutes.
 * Takes the first valid positive value from the arguments in priority order,
 * rounds to the nearest integer and clamps to 15–240 minutes.
 * If nothing valid is found, returns 60.
 */
export function resolveDurationMinutes(...candidates: unknown[]): number {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return Math.min(Math.max(Math.round(value), MIN_DURATION_MINUTES), MAX_DURATION_MINUTES);
    }
  }
  return DEFAULT_DURATION_MINUTES;
}
