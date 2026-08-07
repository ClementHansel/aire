/**
 * Strip chain-of-thought ("reasoning") blocks out of an LLM completion.
 *
 * The platform default model is a hybrid-reasoning Qwen (`qwen/qwen3.5-flash-02-23`),
 * and reasoning models emit their scratchpad inline in `message.content`:
 *
 *   <think>The user is greeting me again… I should…</think>
 *   Halo juga kak! 😊
 *
 * Nothing used to remove it, so the whole scratchpad was shipped to the customer
 * over WhatsApp. Providers are also inconsistent about the opening tag: when the
 * response is truncated, retried, or the reasoning is streamed on a separate
 * channel, the reply can arrive with a DANGLING `</think>` and no `<think>` —
 * exactly the shape seen in production. Both cases are handled here.
 *
 * Deterministic, dependency-free, and applied at the LLM chokepoint so every
 * caller (WhatsApp agent, tool loop, dashboard chat) is covered.
 */

/** Tag names various vendors use to wrap their scratchpad. */
const REASONING_TAGS = ['think', 'thinking', 'reasoning', 'reflection'];

const PAIRED = new RegExp(`<(${REASONING_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');

/**
 * A closing tag with no matching opener: everything before it is scratchpad.
 * Anchored to the LAST such tag so a reply containing several is fully cleaned.
 */
const DANGLING_CLOSE = new RegExp(`^[\\s\\S]*<\\/(?:${REASONING_TAGS.join('|')})\\s*>`, 'i');

/** An opener with no closer (truncated mid-thought): drop the tail. */
const DANGLING_OPEN = new RegExp(`<(?:${REASONING_TAGS.join('|')})\\b[^>]*>[\\s\\S]*$`, 'i');

export function stripReasoning(input: string): string {
  // Cheap guard: no tag, no change — and crucially no trim, so callers that care
  // about leading whitespace (indented list items) are untouched.
  if (!input || !input.includes('<')) return input;

  let text = input.replace(PAIRED, '');

  // Only treat a lone `</think>` as a dangling close once the balanced pairs are
  // gone — otherwise a legitimately-closed block would take the reply with it.
  if (DANGLING_CLOSE.test(text)) {
    text = text.replace(DANGLING_CLOSE, '');
  }
  if (DANGLING_OPEN.test(text)) {
    text = text.replace(DANGLING_OPEN, '');
  }

  if (text === input) return input; // nothing was a reasoning tag; leave it exactly as-is

  // Deliberately CAN return empty. The old code fell back to `input.trim()` when
  // the whole turn was reasoning, on the theory that empty "looks like a provider
  // error" — but that handed the scratchpad straight back, which is exactly the
  // leak this module exists to prevent. It fires on the commonest shape too: a
  // reply truncated at max_tokens mid-`<think>` has no closing tag, so stripping
  // leaves nothing. Callers treat empty as "no usable answer" and re-prompt or
  // fall back to a template — silence beats leaking the deliberation.
  return text.trim();
}
