/**
 * Detect an UNTAGGED chain-of-thought dump.
 *
 * `stripReasoning` handles the tagged case (`<think>…</think>`). But on
 * 2026-08-07 a customer received a full 600-word English deliberation with NO
 * tags at all:
 *
 *   "Okay, let me try to figure out how to respond here. The user asked where
 *    the AIRE branches are located. I just got the tool result … Wait, looking
 *    at the tool data again …"
 *
 * Nothing in the pipeline could see it: the tag-stripper short-circuits on
 * "no `<` in the string", and `parseAction` treated any non-JSON turn as a
 * final answer, so the scratchpad was forwarded verbatim to WhatsApp.
 *
 * This is necessarily a heuristic — there is no marker to key off. It is tuned
 * to be CONSERVATIVE, because a false positive costs one extra LLM round-trip
 * (the caller re-prompts) while a false negative ships the model's private
 * deliberation to a paying customer:
 *
 *  - short text is never flagged (a real reply is short; a scratchpad is not),
 *  - a deliberation OPENER alone is not enough — it must be corroborated,
 *  - the signals are English-only on purpose: the customer persona replies in
 *    Bahasa Indonesia, so English self-talk is already anomalous.
 */

/**
 * Below this length we never flag. A leaked scratchpad is a monologue; a
 * WhatsApp reply that happens to open with "Let me check that for you" is not.
 */
const MIN_LENGTH = 240;

/** How much of the head counts as "the opener". */
const OPENER_WINDOW = 200;

/**
 * The way a model starts talking to ITSELF: an optional filler word, then a
 * first-person plan or a reference to "the user" in the third person.
 */
const OPENER =
  /^(?:\s*(?:okay|ok|alright|so|right|well|hmm+|first(?:ly)?|now|let's see)\s*[,.:—-]?\s*)*(?:let(?:'s|\s+us|\s+me)\b|i\s+(?:need|should|must|will|'ll|have\s+to|want\s+to|can|am\s+going)\b|the\s+user\b|we\s+need\b|looking\s+at\s+(?:the|this)\b|based\s+on\s+the\s+(?:tool|system|user)\b|my\s+(?:task|goal|response|reply)\b)/i;

/**
 * Corroborating tells. Each is something a model says while deliberating and
 * essentially never says to a customer.
 */
const SIGNALS: RegExp[] = [
  /\bthe\s+user\s+(?:asked|wants|is|said|might|may|probably|would|prefers?)\b/i,
  /\b(?:tool\s+result|system\s+prompt|the\s+(?:guidelines?|instructions?|rules?)\s+say|business\s+knowledge|per\s+the\s+(?:rules?|guidelines?))\b/i,
  /\b(?:wait|hmm+)\s*[,.]/i,
  /\blet\s+me\s+(?:check|think|see|draft|verify|count|look)\b/i,
  /\bi\s+should\s+(?:not|also|probably|avoid|include|mention|keep|focus|acknowledge|start)\b/i,
  /\b(?:so\s+)?(?:draft|structure)\s*:/i,
  /\bmake\s+sure\s+(?:not\s+)?to\b/i,
  /\bcheck\s+(?:the\s+)?(?:tone|format|guidelines?)\b/i,
  /\b(?:but|and)\s+the\s+(?:instructions?|guidelines?|prompt)\b/i,
  /\bshould\s+i\s+(?:include|mention|list|add)\b/i,
  /\b(?:count|counting)\s+again\b/i,
  /\bmaybe\s+i\s+(?:should|can|could)\b/i,
];

/** Which corroborating signals fire, ignoring the opener itself. */
export function reasoningSignals(text: string): number {
  // Skip the opener window so "Let me check…" isn't counted twice (once as the
  // opener, once as a signal) and tip a short, innocent reply over the line.
  const body = text.slice(OPENER_WINDOW);
  return SIGNALS.reduce((n, re) => n + (re.test(body) ? 1 : 0), 0);
}

/**
 * True when `text` reads as a model's private deliberation rather than an
 * answer. Callers should treat a hit like an unparseable turn — re-prompt or
 * fall back to a template — never forward it.
 */
export function looksLikeReasoning(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length < MIN_LENGTH) return false;

  const signals = reasoningSignals(t);
  // Enough self-talk anywhere in the body is conclusive on its own — a leak
  // that starts mid-thought (truncated, or the tags were stripped) has no opener.
  if (signals >= 3) return true;

  return OPENER.test(t.slice(0, OPENER_WINDOW)) && signals >= 1;
}
