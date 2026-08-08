/**
 * Generates docs/manuals/05-daftar-notifikasi.md from NOTIFICATION_CATALOG.
 *
 * The document is generated rather than written so it cannot drift from what the
 * system actually sends — the failure mode that made this document worth asking
 * for in the first place. Re-run after changing the catalogue:
 *
 *   pnpm --filter @aire/backend doc:notifications
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  NOTIFICATION_CATALOG,
  CATEGORY_LABELS,
  AUDIENCE_LABELS,
  type NotificationCategory,
} from '../src/modules/notification/notification-catalog';
import { fillForKey, sampleVars } from '../src/modules/notification/notification-renderer.service';

const OUT = resolve(__dirname, '../../../docs/manuals/05-daftar-notifikasi.md');

/** Fence a body so WhatsApp's own `*bold*` markers are not eaten by Markdown. */
const block = (s: string) => ['```text', s, '```'].join('\n');

const lines: string[] = [];

lines.push('# Daftar Notifikasi Otomatis');
lines.push('');
lines.push(
  'Dokumen ini memuat **semua pesan otomatis** yang dikirim sistem atas nama Anda: ' +
    'kapan pesan itu dikirim (trigger), siapa penerimanya, dan apa isinya.',
);
lines.push('');
lines.push(
  'Semua teks di bawah ini **dapat Anda ubah sendiri** lewat menu ' +
    '**Pengaturan → Notifications** di dashboard, tanpa perlu menghubungi tim teknis. ' +
    'Di sana Anda juga bisa mematikan sebagian notifikasi, melihat pratinjau, dan mengirim uji coba ke nomor Anda.',
);
lines.push('');
lines.push('> ⚙️ Dokumen ini dihasilkan otomatis dari konfigurasi sistem, jadi isinya selalu sama dengan yang benar-benar dikirim.');
lines.push('');

// ── How variables work ──────────────────────────────────────────────────────
lines.push('## Cara membaca variabel');
lines.push('');
lines.push(
  'Kata di dalam kurung kurawal seperti `{customerName}` adalah **variabel** — ' +
    'sistem menggantinya dengan data asli saat pesan dikirim.',
);
lines.push('');
lines.push('- `Halo kak {customerName}!` → `Halo kak Budi!`');
lines.push(
  '- Variabel bertanda **opsional** kadang kosong (misalnya voucher tanpa tanggal kedaluwarsa). ' +
    'Bila kosong, **seluruh baris yang memakai variabel itu otomatis hilang** — jadi pelanggan tidak pernah ' +
    'menerima kalimat setengah jadi seperti "Berlaku sampai ."',
);
lines.push('- Anda hanya boleh memakai variabel yang terdaftar pada masing-masing notifikasi. Variabel lain akan ditolak saat disimpan.');
lines.push('');

// ── Summary table ───────────────────────────────────────────────────────────
lines.push('## Ringkasan');
lines.push('');
lines.push('| # | Notifikasi | Penerima | Trigger singkat | Bisa dimatikan? |');
lines.push('|---|---|---|---|---|');
NOTIFICATION_CATALOG.forEach((d, i) => {
  // First sentence only, without its full stop — one is appended below, and a
  // single-sentence trigger would otherwise end up with "..".
  const short = d.trigger.split('. ')[0]!.replace(/\.$/, '').replace(/\|/g, '\\|');
  lines.push(
    `| ${i + 1} | [${d.title}](#${anchor(d.title)}) | ${AUDIENCE_LABELS[d.audience]} | ${short}. | ${
      d.lockedReason ? '🔒 Terkunci' : d.canDisable ? 'Ya' : 'Tidak'
    } |`,
  );
});
lines.push('');

// ── Detail per category ─────────────────────────────────────────────────────
const categories = [...new Set(NOTIFICATION_CATALOG.map((d) => d.category))] as NotificationCategory[];

for (const cat of categories) {
  lines.push(`## ${CATEGORY_LABELS[cat]}`);
  lines.push('');

  for (const d of NOTIFICATION_CATALOG.filter((x) => x.category === cat)) {
    lines.push(`### ${d.title}`);
    lines.push('');
    lines.push(`**Penerima:** ${AUDIENCE_LABELS[d.audience]}`);
    lines.push('');
    lines.push(`**Trigger:** ${d.trigger}`);
    lines.push('');

    if (d.variables.length > 0) {
      lines.push('**Variabel yang tersedia:**');
      lines.push('');
      lines.push('| Variabel | Isi | Contoh | Opsional |');
      lines.push('|---|---|---|---|');
      for (const v of d.variables) {
        const sample = v.sample.replace(/\n/g, ' / ').replace(/\|/g, '\\|');
        lines.push(`| \`{${v.name}}\` | ${v.description} | ${sample} | ${v.optional ? 'Ya' : '—'} |`);
      }
      lines.push('');
    }

    lines.push('**Isi pesan (bawaan):**');
    lines.push('');
    lines.push(block(d.defaultBody));
    lines.push('');
    lines.push('**Contoh hasil yang diterima:**');
    lines.push('');
    lines.push(block(fillForKey(d.key, d.defaultBody, sampleVars(d))));
    lines.push('');

    if (d.lockedReason) {
      lines.push(`> 🔒 **Teks terkunci.** ${d.lockedReason}`);
      lines.push('');
    } else if (!d.canDisable) {
      lines.push('> ℹ️ Teks bisa diubah, tetapi notifikasi ini tidak bisa dimatikan karena dibutuhkan oleh alur transaksi.');
      lines.push('');
    }
    if (d.inactive) {
      lines.push('> ⚠️ Notifikasi ini belum aktif — belum ada pemicunya di sistem.');
      lines.push('');
    }
  }
}

// ── What is NOT in this list ────────────────────────────────────────────────
lines.push('## Yang tidak termasuk daftar ini');
lines.push('');
lines.push(
  '- **Broadcast / campaign manual** — isinya Anda tulis sendiri setiap kali mengirim, di menu Broadcast ' +
    '(mendukung variabel `{name}`).',
);
lines.push(
  '- **Balasan asisten WhatsApp (Irene)** — dibuat oleh AI mengikuti percakapan, bukan template tetap. ' +
    'Gaya bicaranya diatur di pengaturan asisten, bukan di sini.',
);
lines.push(
  '- **Notifikasi di dalam dashboard** (badge, papan antrian realtime) — tampil di layar, tidak dikirim ke WhatsApp.',
);
lines.push('');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'), 'utf8');
// eslint-disable-next-line no-console
console.log(`Wrote ${OUT} (${NOTIFICATION_CATALOG.length} notifications)`);

function anchor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}
