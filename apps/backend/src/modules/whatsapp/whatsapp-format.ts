/**
 * Convert Markdown-flavoured text (which the LLM naturally emits) into WhatsApp's
 * own lightweight markup before sending. WhatsApp does NOT understand Markdown:
 * `**bold**` shows the literal asterisks, `[label](url)` shows the raw brackets,
 * and `# Heading` shows the hashes. WhatsApp bold is a SINGLE `*asterisk*`.
 *
 * This runs at the single outbound chokepoint (WhatsappService.sendText) so every
 * reply — fluid LLM, rigid template, booking prompt — is normalised regardless of
 * where the text came from. Kept deterministic and dependency-free.
 */
import { stripReasoning } from '../../common/strip-reasoning';

/**
 * Romantic/flirty emoji a CS persona should never send a customer. The system
 * prompt asks the model to avoid these, but it keeps slipping them back in
 * (Irene was signing off "💕🙏" on every message), so the outbound path enforces
 * it deterministically instead of hoping the model complies.
 */
// NB: the optional variation selector sits OUTSIDE the character class — inside
// it, `?` would be a literal and we would strip question marks from replies.
const FLIRTY_EMOJI =
  /[\u{1F495}-\u{1F49F}\u{2764}\u{1F48B}\u{1F618}\u{1F617}\u{1F619}\u{1F61A}\u{1F60D}\u{1F970}\u{1F929}\u{1F9E1}]\u{FE0F}?/gu;

export function formatForWhatsApp(input: string): string {
  if (!input) return input;
  // Last line of defence against a reasoning model leaking its <think> scratchpad
  // to the customer. LLMRouterService already strips it, but this chokepoint sees
  // every outbound message, including replies that never touched the router.
  let text = stripReasoning(input);

  // Drop flirty emoji, then tidy the space they leave behind ("bantu! 💕🙏" →
  // "bantu! 🙏", "ya kak 💕" → "ya kak").
  if (FLIRTY_EMOJI.test(text)) {
    text = text.replace(FLIRTY_EMOJI, '');
    text = text.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
  }

  // Markdown links [label](url) → "label: url" (or just the url when the label is
  // empty/identical). WhatsApp renders bare URLs as tappable links; the brackets
  // would otherwise leak verbatim.
  text = text.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => {
    const l = label.trim();
    return !l || l === url ? url : `${l}: ${url}`;
  });

  // Headings (#, ##, … up to ######) → bold line, hashes stripped. WhatsApp has no
  // heading syntax, so we promote them to bold instead of leaking the hashes.
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (_m, h: string) => `*${h.trim()}*`);

  // Bold: Markdown **bold** or __bold__ → WhatsApp *bold*. Done before the bullet
  // pass so a real bold span never gets mistaken for a list marker.
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  text = text.replace(/__(.+?)__/g, '*$1*');

  // List bullets: a line beginning with "- ", "* " or "+ " → "• ". A single leading
  // "* " would otherwise read as a dangling (unclosed) bold marker in WhatsApp.
  text = text.replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ');

  return text;
}
