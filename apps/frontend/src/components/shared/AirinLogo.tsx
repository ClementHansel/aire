/** The official Airin mark, for every Airin-branded shell (hub, admin, POS,
 * employee, auth screens).
 *
 * Three rules this component exists to enforce:
 *  - Never hand-draw the brand. Before this, most shells rendered a purple
 *    rounded square with a bold "A" in it — a stand-in from before the brand
 *    kit landed (2026-07-30) that survived long past its welcome.
 *  - Swap the asset per theme. The gradient mark runs from near-black into
 *    purple, so on the dark theme its left half sank into the background and
 *    the logo read as half a shape (caught in a dark-mode screenshot). Light
 *    theme gets the gradient, dark theme the flat white variant; only one is
 *    ever visible, and `dark:` keys off the .dark class on <html> (see the
 *    @custom-variant in globals.css), not the OS setting.
 *  - The wordmark SVG is white-filled and is therefore only safe on the dark
 *    brand panel of the login screen. The lettering here is live text in the
 *    display font instead, so it follows the theme's text colour. */
export function AirinLogo({
  size = 'md',
  showWordmark = true,
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  className?: string;
}) {
  const mark = size === 'lg' ? 'w-11 h-11' : size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  const text = size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-sm' : 'text-base';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/airin-icon-gradient.svg"
        alt="Airin"
        className={`${mark} object-contain shrink-0 dark:hidden`}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/airin-icon-white.svg"
        alt=""
        aria-hidden="true"
        className={`${mark} object-contain shrink-0 hidden dark:block`}
      />
      {showWordmark && (
        <span className={`font-display font-semibold text-text-primary ${text}`}>airin</span>
      )}
    </span>
  );
}
