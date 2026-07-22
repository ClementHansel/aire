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
export function formatForWhatsApp(input: string): string {
  if (!input) return input;
  let text = input;

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
