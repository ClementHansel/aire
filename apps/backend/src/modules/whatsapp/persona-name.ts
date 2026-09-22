/**
 * The agent's name, as it is safe to drop into a sentence.
 *
 * `agents.name` is a free-text field an owner fills in, and the system prompt
 * substitutes it into a dozen example sentences ("mau ${who} kirimin daftar
 * lengkapnya kak?", "Aku ${who}, CS-nya ${brand}"). That only works while the
 * field holds a NAME.
 *
 * On the live Kalibrasi tenant it held an entire greeting —
 * "Halo kak! Aku Kalia, CS-nya Kalibrasi.com" — so the first-turn example the
 * model was shown read:
 *
 *   "Halo kak! 😊 Aku Halo kak! Aku Kalia, CS-nya Kalibrasi.com, CS-nya
 *    PT Dinamika Kalibrasi Indonesia. Ada yang bisa Halo kak! Aku Kalia,
 *    CS-nya Kalibrasi.com bantu hari ini?"
 *
 * The model copies examples closely, so this alone produced garbled, unnatural
 * replies — one of the exact complaints in the 2026-09-22 feedback. Fixing the
 * row fixes that tenant; this fixes the class, because the field is free text
 * and the next owner will do the same thing.
 *
 * Deliberately CONSERVATIVE. A name that looks like a name is returned
 * untouched, including legitimate multi-word ones ("CS Aire", "Kak Irene"),
 * because mangling a real name is a worse outcome than passing through a
 * slightly long one.
 */

/**
 * Greeting words AND the address terms that ride along with them ("halo kak").
 * Stripped repeatedly, because owners stack them: "Halo kak! Kalia".
 */
const LEADING_NOISE =
  /^(?:halo+|hallo+|hai+|hi|hello+|helo+|hey+|selamat\s+(?:pagi|siang|sore|malam)|assalamu'?alaikum|kak|kakak|pak|bu|mas|mbak|min|admin)\b[\s,.!?~-]*/iu;

/**
 * Words that continue a SENTENCE rather than a name, so a capture ending in one
 * has over-reached: "Saya Rina dari Bengkel Jaya" must yield "Rina", not
 * "Rina dari".
 */
const CONNECTOR = /^(?:dari|di|ke|dan|atau|untuk|yang|adalah|selaku|sebagai|from|of|at|the|and|your|our|a|an)$/i;

/** "Aku X", "Saya X", "I'm X", "This is X" — the name hiding inside a sentence. */
const SELF_INTRO = /\b(?:aku|saya|nama\s*(?:ku|saya)?|i'?m|i\s+am|this\s+is)\s+([\p{L}][\p{L}.'-]*(?:\s+[\p{L}][\p{L}.'-]*)?)/iu;

/** Sentence-ish punctuation: a name does not contain these. */
const SENTENCE_PUNCT = /[!?;:]|[.,]\s/u;

const MAX_NAME_LEN = 24;

/**
 * True when the stored value is clearly a sentence rather than a name.
 * Kept narrow on purpose — see the module note about not mangling real names.
 */
function looksLikeSentence(name: string): boolean {
  return SENTENCE_PUNCT.test(name) || name.length > MAX_NAME_LEN || name.split(/\s+/).length > 4;
}

/**
 * Reduce a stored persona name to something quotable inside an example
 * sentence. Returns null when nothing usable survives, so the caller can fall
 * back to its own neutral wording ("kami") rather than to a fragment.
 */
export function personaDisplayName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (!looksLikeSentence(name)) return name;

  // "Halo kak! Aku Kalia, CS-nya Kalibrasi.com" → "Kalia".
  const intro = SELF_INTRO.exec(name);
  if (intro?.[1]) {
    // Trim a trailing role/company clause the capture may have picked up, and
    // any punctuation left clinging to the word.
    let candidate = intro[1].split(/[,.]/)[0]!.trim();
    // Drop a trailing connector the two-word capture may have swallowed.
    const parts = candidate.split(' ').filter(Boolean);
    if (parts.length === 2 && CONNECTOR.test(parts[1]!)) candidate = parts[0]!;
    if (candidate && candidate.length <= MAX_NAME_LEN) return candidate;
  }

  // No self-introduction: drop leading greeting noise and take what is left,
  // up to the first sentence break.
  // Strip stacked greeting/address terms ("Halo kak! Kalia" → "Kalia"), with a
  // bound so a pathological value cannot spin here.
  let stripped = name;
  for (let i = 0; i < 4; i++) {
    const next = stripped.replace(LEADING_NOISE, '').trim();
    if (next === stripped) break;
    stripped = next;
  }
  const firstClause = stripped.split(/[!?;:]|[.,]\s/u)[0]!.trim();
  if (firstClause && firstClause.length <= MAX_NAME_LEN) return firstClause;

  // Still a mouthful — take the first couple of words rather than emitting a
  // paragraph into an example sentence.
  const words = firstClause.split(' ').filter(Boolean).slice(0, 2).join(' ');
  return words && words.length <= MAX_NAME_LEN ? words : null;
}
