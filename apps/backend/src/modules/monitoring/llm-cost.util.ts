/**
 * Rough LLM cost estimation for the monitoring dashboards. Rates are USD per
 * 1,000,000 tokens and are intentionally approximate — they exist to give the
 * owner a sense of spend, not to bill. Self-hosted providers (Hermes/Ollama)
 * cost nothing. Matched by substring on the model name recorded in
 * agent_invocations.name, most specific first.
 */
interface Rate { match: string; promptPerM: number; completionPerM: number }

const RATES: Rate[] = [
  { match: 'gpt-4o-mini', promptPerM: 0.15, completionPerM: 0.6 },
  { match: 'gpt-4o', promptPerM: 2.5, completionPerM: 10 },
  { match: 'gpt-4', promptPerM: 10, completionPerM: 30 },
  { match: 'claude-3.5-sonnet', promptPerM: 3, completionPerM: 15 },
  { match: 'claude-3-haiku', promptPerM: 0.25, completionPerM: 1.25 },
  { match: 'claude', promptPerM: 3, completionPerM: 15 },
  { match: 'llama', promptPerM: 0.2, completionPerM: 0.2 },
  { match: 'gemini', promptPerM: 0.5, completionPerM: 1.5 },
];

/** Local / self-hosted models — no per-token cost. */
const FREE_MATCHES = ['hermes', 'ollama', 'local', 'unknown'];

/** Fallback rate when the model isn't recognised (a mid-range assumption). */
const DEFAULT_RATE: Omit<Rate, 'match'> = { promptPerM: 0.5, completionPerM: 1.5 };

export function estimateCostUsd(
  model: string | null | undefined,
  promptTokens: number,
  completionTokens: number,
): number {
  const name = (model ?? '').toLowerCase();
  if (!name || FREE_MATCHES.some((f) => name.includes(f))) return 0;
  const rate = RATES.find((r) => name.includes(r.match)) ?? DEFAULT_RATE;
  const cost = (promptTokens * rate.promptPerM + completionTokens * rate.completionPerM) / 1_000_000;
  // Round to 4 dp (fractions of a cent still visible).
  return Math.round(cost * 10000) / 10000;
}
