// ─────────────────────────────────────────────────────────────────────────────
// build-docs.mjs — pre-render the markdown docs into a bundled TS module.
//
// Reads the repo's user manuals + technical docs, converts them to HTML with
// GitHub-style heading anchors + a per-doc table of contents, rewrites image
// and cross-doc links to the /docs routes, and writes:
//   • src/app/docs/generated.ts   (the bundled content — imported by the app)
//   • public/docs/images/*        (screenshots copied so they're served)
//
// Rendering at build time (not runtime) keeps the production app dependency-free
// and works inside the Next.js `output: standalone` Docker image.
//
// Regenerate after editing any doc:
//   (with `marked` resolvable) node apps/frontend/scripts/build-docs.mjs
// ─────────────────────────────────────────────────────────────────────────────
// `marked` is a build-time-only tool (not an app dependency). Resolve it from
// the default location, or from MARKED_PATH when run against an isolated install.
const { Marked } = await import(process.env.MARKED_PATH || 'marked');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, '..');            // apps/frontend
const DOCS_ROOT = path.join(FRONTEND, '../../docs');    // aire/docs
const OUT_TS = path.join(FRONTEND, 'src/app/docs/generated.ts');
const OUT_IMG = path.join(FRONTEND, 'public/docs/images');

// ── The published set. Order = display order within each category. ───────────
const REGISTRY = [
  // Manuals — visible to any signed-in user.
  { file: 'manuals/01-superadmin-manual.md', slug: 'superadmin-manual', category: 'manual', audience: 'Platform Super-Admin', blurb: 'Run the whole airin platform: tenants, modules, pricing, health.' },
  { file: 'manuals/02-tenant-owner-manual.md', slug: 'tenant-owner-manual', category: 'manual', audience: 'Tenant Owner / Manager', blurb: 'Configure and run one business end to end — the biggest manual.' },
  { file: 'manuals/03-employee-manual.md', slug: 'employee-manual', category: 'manual', audience: 'Employee', blurb: 'POS, arrival queue, shifts, memberships, stock and HR.' },
  { file: 'manuals/04-customer-manual.md', slug: 'customer-manual', category: 'manual', audience: 'Customer', blurb: 'eMenu, kiosk, queue, member portal, bookings and WhatsApp.' },
  { file: 'manuals/05-daftar-notifikasi.md', slug: 'daftar-notifikasi', category: 'manual', audience: 'Tenant Owner / Manager', blurb: 'Setiap pesan otomatis: pemicunya, isinya, dan cara mengubahnya sendiri.' },
  // Technical — gated to admin/staff roles.
  { file: 'tech/01-architecture.md', slug: 'tech-architecture', category: 'tech', audience: 'Technical', blurb: 'System overview, stack, topology, integrations.' },
  { file: 'tech/02-backend.md', slug: 'tech-backend', category: 'tech', audience: 'Technical', blurb: 'NestJS modules, auth, multi-tenancy, core flows.' },
  { file: 'tech/03-frontend.md', slug: 'tech-frontend', category: 'tech', audience: 'Technical', blurb: 'Next.js routing, state, API client, i18n and theming.' },
  { file: 'tech/04-database.md', slug: 'tech-database', category: 'tech', audience: 'Technical', blurb: 'Postgres schema, migrations, tenancy model, enums.' },
  { file: 'tech/05-api-reference.md', slug: 'tech-api-reference', category: 'tech', audience: 'Technical', blurb: 'Every HTTP endpoint by module, with role and purpose.' },
  { file: 'tech/06-membership-lifecycle.md', slug: 'tech-membership-lifecycle', category: 'tech', audience: 'Technical', blurb: 'Membership sale → activation → grace → renewal, end to end.' },
  { file: 'tech/07-branch-bridge-protocol.md', slug: 'tech-branch-bridge-protocol', category: 'tech', audience: 'Technical', blurb: 'On-premise branch bridge: discovery and CCTV.' },
  { file: 'tech/08-device-registry-topology.md', slug: 'tech-device-registry-topology', category: 'tech', audience: 'Technical', blurb: 'Device registry and per-branch network topology.' },
  { file: 'n8n-agent-builder.md', slug: 'tech-n8n-agent-builder', category: 'tech', audience: 'Technical', blurb: 'The hosted n8n visual agent-builder integration.' },
];

// filename (basename) → slug, for rewriting cross-doc .md links.
const FILE_TO_SLUG = new Map(REGISTRY.map((d) => [path.basename(d.file), d.slug]));

// Decode the handful of HTML entities marked emits, so heading ids + TOC text
// are computed from the real characters (e.g. "&" not "&amp;").
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&');
}

// ── GitHub-style heading slug (matches the anchors authored in the docs). ────
function githubSlug(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')   // drop punctuation
    .trim()
    .replace(/\s/g, '-');       // each space → one hyphen (no collapse — matches GitHub anchors)
}

function renderDoc(raw) {
  const toc = [];
  const seen = new Map();
  const marked = new Marked({ gfm: true, breaks: false });

  const renderer = {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const plain = decodeEntities(text.replace(/<[^>]+>/g, ''));
      let id = githubSlug(plain);
      if (seen.has(id)) { const n = seen.get(id) + 1; seen.set(id, n); id = `${id}-${n}`; }
      else seen.set(id, 0);
      if (depth === 2 || depth === 3) toc.push({ id, text: plain, level: depth });
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    },
    image({ href, title, text }) {
      const src = href.replace(/^(\.\/)?images\//, '/docs/images/');
      const t = title ? ` title="${title}"` : '';
      return `<img src="${src}" alt="${text || ''}"${t} loading="lazy" />`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      let out = href;
      const md = href.match(/([^/]+\.md)(#.*)?$/);
      if (md && FILE_TO_SLUG.has(md[1])) {
        out = `/docs/${FILE_TO_SLUG.get(md[1])}${md[2] || ''}`;
      }
      const external = /^https?:\/\//.test(out);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
      const t = title ? ` title="${title}"` : '';
      return `<a href="${out}"${t}${attrs}>${text}</a>`;
    },
  };

  marked.use({ renderer });
  const html = marked.parse(raw);
  return { html, toc };
}

// ── Build ────────────────────────────────────────────────────────────────────
const docs = REGISTRY.map((d, i) => {
  const raw = fs.readFileSync(path.join(DOCS_ROOT, d.file), 'utf8');
  const titleMatch = raw.match(/^#\s+(.+?)\s*$/m);
  const title = titleMatch ? titleMatch[1].replace(/[*_`]/g, '') : d.slug;
  const { html, toc } = renderDoc(raw);
  const words = raw.split(/\s+/).filter(Boolean).length;
  return {
    slug: d.slug, title, category: d.category, audience: d.audience,
    blurb: d.blurb, order: i, words, minutes: Math.max(1, Math.round(words / 200)),
    toc, html,
  };
});

// Copy manual images into public/ so they're served at /docs/images/*.
fs.mkdirSync(OUT_IMG, { recursive: true });
const IMG_SRC = path.join(DOCS_ROOT, 'manuals/images');
let copied = 0;
for (const f of fs.readdirSync(IMG_SRC)) {
  if (/\.(png|jpe?g|svg|webp|gif)$/i.test(f)) {
    fs.copyFileSync(path.join(IMG_SRC, f), path.join(OUT_IMG, f));
    copied++;
  }
}

const header = `// AUTO-GENERATED by apps/frontend/scripts/build-docs.mjs — DO NOT EDIT BY HAND.
// Regenerate after editing any doc in /docs. See the script header for how.
export type DocCategory = 'manual' | 'tech';
export interface DocTocItem { id: string; text: string; level: number }
export interface DocEntry {
  slug: string;
  title: string;
  category: DocCategory;
  audience: string;
  blurb: string;
  order: number;
  words: number;
  minutes: number;
  toc: DocTocItem[];
  html: string;
}
`;

fs.mkdirSync(path.dirname(OUT_TS), { recursive: true });
fs.writeFileSync(OUT_TS, `${header}\nexport const DOCS: DocEntry[] = ${JSON.stringify(docs)};\n`);

console.log(`✓ ${docs.length} docs → ${path.relative(FRONTEND, OUT_TS)}`);
console.log(`✓ ${copied} images → ${path.relative(FRONTEND, OUT_IMG)}`);
for (const d of docs) console.log(`   ${d.category.padEnd(6)} ${d.slug.padEnd(30)} ${d.toc.length} sections · ${d.minutes}m`);
