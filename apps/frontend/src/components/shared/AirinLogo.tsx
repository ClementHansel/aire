/** The official Airin mark, for every surface that needs a logo and has no
 * tenant logo to show.
 *
 * Rules this component exists to enforce:
 *  - Never hand-draw the brand. Before this, most shells rendered a purple
 *    rounded square holding a bold letter — the Airin "A" in staff shells, the
 *    tenant's initial on customer-facing pages. Both are stand-ins.
 *  - A tenant's own uploaded logo always wins. This is the *default*: render it
 *    only in the `logoUrl ? <img> : <AirinLogo />` fallback position.
 *  - Match the mark to its background. The gradient asset runs from near-black
 *    into purple, so it disappears on a dark ground (its left half sank into
 *    the dark theme's background and the logo read as half a shape). `tone`
 *    picks: 'auto' follows the theme, 'onDark' forces the white variant for
 *    surfaces that are dark whatever the theme — the queue board's slate
 *    ground, the price menu's brand-purple header.
 *  - The wordmark SVG is white-filled and only safe on the login screen's dark
 *    panel, so the lettering here is live text that follows the theme instead.
 */
export function AirinLogo({
  size = 'md',
  showWordmark = true,
  tone = 'auto',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showWordmark?: boolean;
  tone?: 'auto' | 'onDark';
  className?: string;
}) {
  const mark = { sm: 'w-7 h-7', md: 'w-9 h-9', lg: 'w-11 h-11', xl: 'w-14 h-14' }[size];
  const text = { sm: 'text-sm', md: 'text-base', lg: 'text-lg', xl: 'text-xl' }[size];
  const box = `${mark} object-contain shrink-0`;
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {tone === 'onDark' ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src="/brand/airin-icon-white.svg" alt="Airin" className={box} />
      ) : (
        <>
          {/* Only one of the pair is ever visible; `dark:` keys off the .dark
              class on <html> (see globals.css), not the OS setting. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/airin-icon-gradient.svg" alt="Airin" className={`${box} dark:hidden`} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/airin-icon-white.svg" alt="" aria-hidden="true" className={`${box} hidden dark:block`} />
        </>
      )}
      {showWordmark && (
        <span className={`font-display font-semibold text-text-primary ${text}`}>airin</span>
      )}
    </span>
  );
}
