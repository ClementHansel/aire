# `/docs` — Airin documentation site

A branded, in-app documentation site at **`app.useairin.id/docs`**. It renders the
repo's markdown docs (`aire/docs/manuals/*` and `aire/docs/tech/*`) as proper web
pages with an index, per-doc reader, on-page table of contents, and a branded
**print-to-PDF** export.

## How it works

- **Content is pre-rendered at build time**, not at runtime. `scripts/build-docs.mjs`
  reads the markdown, converts it to HTML (GitHub-style heading anchors + a TOC),
  rewrites `images/*` → `/docs/images/*` and cross-doc `*.md` links → `/docs/<slug>`,
  and writes:
  - `src/app/docs/generated.ts` — the bundled content (imported by the pages)
  - `public/docs/images/*` — the manual screenshots, copied so they're served
  This keeps the app **dependency-free at runtime** and works inside the Next.js
  `output: standalone` Docker image (no runtime `fs` reads of files outside the app).

- **Access control (client-side, matches the rest of the app):**
  - The whole site requires a signed-in session (`layout.tsx` redirects to
    `/?next=/docs/…` otherwise).
  - **User manuals** — visible to any signed-in user.
  - **Technical docs** — gated to staff/admin roles
    (`platform_super_admin`, `tenant_owner`, `outlet_admin`) via `canViewTech()` in
    `lib.tsx`. Cashiers see manuals only; a tech deep-link shows a "Staff access only"
    notice.

- **PDF export** — the "Download PDF" button calls `window.print()`. `docs.css` has a
  print stylesheet that hides app chrome and adds an Airin-branded cover page, a
  repeating navy/gold running header + footer, and page-break rules. Brand colours are
  pinned to Airin (navy `#16213c` + gold `#e2a336`) regardless of tenant branding.

## Regenerating after editing a doc

The content is a committed artifact, so editing a `.md` file requires a regenerate:

```bash
cd apps/frontend
npm i -D marked        # build-time-only tool; not an app dependency
npm run docs:build     # rewrites generated.ts + copies images
```

To publish a **new** doc, add an entry to the `REGISTRY` array in
`scripts/build-docs.mjs` (file path, slug, category, audience, blurb) and regenerate.

## Files

| File | Role |
|------|------|
| `scripts/build-docs.mjs` | Generator (build-time). Owns the published `REGISTRY`. |
| `src/app/docs/generated.ts` | Auto-generated content — **do not edit by hand**. |
| `src/app/docs/lib.tsx` | Selectors, role gate (`canViewTech`), `AirinMark`. |
| `src/app/docs/layout.tsx` | Auth guard + branded shell + sidebar nav. |
| `src/app/docs/page.tsx` | Index landing (hero + cards). |
| `src/app/docs/[slug]/page.tsx` | Doc reader + on-page TOC + PDF cover/header/footer. |
| `src/app/docs/docs.css` | Screen + print (PDF) styling. |
