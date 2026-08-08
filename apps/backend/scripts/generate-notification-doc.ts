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
lines.push('**Dokumen referensi untuk Pemilik Usaha (Tenant Owner)**');
lines.push('');
lines.push(
  'Dokumen ini memuat seluruh pesan otomatis yang dikirimkan sistem atas nama usaha Anda. ' +
    'Untuk setiap pesan dicantumkan pemicunya (kondisi yang menyebabkan pesan dikirim), penerimanya, ' +
    'variabel yang tersedia, teks bawaan, serta contoh hasil yang diterima penerima.',
);
lines.push('');
lines.push(
  'Seluruh teks dalam dokumen ini dapat diubah sendiri oleh Pemilik Usaha melalui menu ' +
    '**Pengaturan → Notifications** pada dashboard, tanpa memerlukan bantuan tim teknis dan tanpa ' +
    'pembaruan sistem. Perubahan yang disimpan berlaku pada pengiriman pesan berikutnya. Panduan ' +
    'penggunaan halaman tersebut terdapat pada ' +
    '[Panduan Pemilik Usaha §11.2](02-tenant-owner-manual.md#112-notifications-settings--notifications).',
);
lines.push('');
lines.push(
  '> **Catatan.** Dokumen ini dihasilkan otomatis dari konfigurasi sistem. Isinya karena itu selalu ' +
    'identik dengan pesan yang benar-benar dikirimkan.',
);
lines.push('');
lines.push('---');
lines.push('');

// ── How variables work ──────────────────────────────────────────────────────
lines.push('## 1. Ketentuan penggunaan variabel');
lines.push('');
lines.push(
  'Kata yang ditulis di dalam kurung kurawal, misalnya `{customerName}`, merupakan **variabel**: ' +
    'sistem menggantinya dengan data sebenarnya pada saat pesan dikirim.',
);
lines.push('');
lines.push('Ketentuan yang berlaku:');
lines.push('');
lines.push(
  '1. **Penggantian nilai.** `Halo kak {customerName}!` akan terkirim sebagai `Halo kak Budi!`.',
);
lines.push(
  '2. **Variabel opsional.** Variabel yang ditandai *opsional* dapat bernilai kosong, misalnya voucher ' +
    'tanpa tanggal kedaluwarsa. Apabila nilainya kosong, **seluruh baris yang memuat variabel tersebut ' +
    'tidak ikut dikirim**. Ketentuan ini mencegah penerima menerima kalimat tidak lengkap seperti ' +
    '"Berlaku sampai .".',
);
lines.push(
  '3. **Pembatasan variabel.** Hanya variabel yang terdaftar pada masing-masing notifikasi yang boleh ' +
    'digunakan. Variabel di luar daftar akan ditolak pada saat penyimpanan.',
);
lines.push(
  '4. **Pesan terkunci.** Sebagian pesan memuat kode keamanan sekali pakai dan teksnya tidak dapat diubah. ' +
    'Pesan tersebut ditandai 🔒 pada tabel ringkasan.',
);
lines.push('');
lines.push('---');
lines.push('');

// ── Summary table ───────────────────────────────────────────────────────────
lines.push('## 2. Ringkasan seluruh notifikasi');
lines.push('');
lines.push(`Sistem mengirimkan ${NOTIFICATION_CATALOG.length} jenis pesan otomatis.`);
lines.push('');
lines.push('| No. | Notifikasi | Penerima | Pemicu (ringkas) | Dapat dimatikan |');
lines.push('|---|---|---|---|---|');
NOTIFICATION_CATALOG.forEach((d, i) => {
  // First sentence only, without its full stop — one is appended below, and a
  // single-sentence trigger would otherwise end up with "..".
  const short = d.trigger.split('. ')[0]!.replace(/\.$/, '').replace(/\|/g, '\\|');
  lines.push(
    `| ${i + 1} | ${d.title} | ${AUDIENCE_LABELS[d.audience]} | ${short}. | ${
      d.lockedReason ? '🔒 Tidak (terkunci)' : d.canDisable ? 'Ya' : 'Tidak'
    } |`,
  );
});
lines.push('');

// ── Detail per category ─────────────────────────────────────────────────────
const categories = [...new Set(NOTIFICATION_CATALOG.map((d) => d.category))] as NotificationCategory[];

lines.push('---');
lines.push('');
lines.push('## 3. Rincian per notifikasi');
lines.push('');

categories.forEach((cat, ci) => {
  lines.push(`### 3.${ci + 1} ${CATEGORY_LABELS[cat]}`);
  lines.push('');

  NOTIFICATION_CATALOG.filter((x) => x.category === cat).forEach((d, di) => {
    lines.push(`#### 3.${ci + 1}.${di + 1} ${d.title}`);
    lines.push('');
    lines.push('| | |');
    lines.push('|---|---|');
    lines.push(`| **Penerima** | ${AUDIENCE_LABELS[d.audience]} |`);
    lines.push(`| **Dapat dimatikan** | ${d.lockedReason ? 'Tidak (terkunci)' : d.canDisable ? 'Ya' : 'Tidak'} |`);
    lines.push(`| **Kode sistem** | \`${d.key}\` |`);
    lines.push('');
    lines.push(`**Pemicu.** ${d.trigger}`);
    lines.push('');

    if (d.variables.length > 0) {
      lines.push('**Variabel yang tersedia.**');
      lines.push('');
      lines.push('| Variabel | Keterangan | Contoh nilai | Opsional |');
      lines.push('|---|---|---|---|');
      for (const v of d.variables) {
        const sample = v.sample.replace(/\n/g, ' / ').replace(/\|/g, '\\|');
        lines.push(`| \`{${v.name}}\` | ${v.description} | ${sample} | ${v.optional ? 'Ya' : 'Tidak'} |`);
      }
      lines.push('');
    } else {
      lines.push('**Variabel yang tersedia.** Tidak ada; pesan ini tidak memuat variabel.');
      lines.push('');
    }

    lines.push('**Teks bawaan.**');
    lines.push('');
    lines.push(block(d.defaultBody));
    lines.push('');
    lines.push('**Contoh hasil yang diterima.**');
    lines.push('');
    lines.push(block(fillForKey(d.key, d.defaultBody, sampleVars(d))));
    lines.push('');

    if (d.lockedReason) {
      lines.push(`> 🔒 **Teks terkunci.** ${d.lockedReason}`);
      lines.push('');
    } else if (!d.canDisable) {
      lines.push(
        '> **Tidak dapat dimatikan.** Teks pesan ini dapat diubah, namun pengirimannya tidak dapat ' +
          'dinonaktifkan karena dibutuhkan oleh alur transaksi.',
      );
      lines.push('');
    }
    if (d.inactive) {
      lines.push('> **Belum aktif.** Notifikasi ini belum memiliki pemicu di sistem.');
      lines.push('');
    }
  });
});

// ── What is NOT in this list ────────────────────────────────────────────────
lines.push('---');
lines.push('');
lines.push('## 4. Pesan yang tidak tercakup dalam dokumen ini');
lines.push('');
lines.push(
  'Tiga jenis pesan berikut tidak diatur melalui halaman **Pengaturan → Notifications** dan karena itu ' +
    'tidak tercantum di atas:',
);
lines.push('');
lines.push(
  '1. **Broadcast / campaign manual.** Teksnya disusun sendiri oleh pengguna pada setiap pengiriman ' +
    'melalui menu **WA Broadcast**, dengan dukungan variabel `{name}`.',
);
lines.push(
  '2. **Balasan asisten WhatsApp.** Disusun oleh AI mengikuti jalannya percakapan, bukan berdasarkan ' +
    'template tetap. Gaya bahasanya diatur pada pengaturan asisten.',
);
lines.push(
  '3. **Notifikasi di dalam dashboard.** Misalnya penanda jumlah dan papan antrian waktu nyata; ' +
    'ditampilkan di layar dan tidak dikirimkan melalui WhatsApp.',
);
lines.push('');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join('\n'), 'utf8');
// eslint-disable-next-line no-console
console.log(`Wrote ${OUT} (${NOTIFICATION_CATALOG.length} notifications)`);

