/**
 * THE registry of every automatic message this platform sends.
 *
 * One entry per notification: what fires it, which variables it may use, and the
 * default body. This file is the single source of truth for three things that
 * used to drift apart:
 *
 *   1. the text that actually goes out (via NotificationRenderer),
 *   2. the owner-facing editor at /dashboard/settings/notifications,
 *   3. the "Daftar Notifikasi" document handed to tenants.
 *
 * Adding a notification means adding it HERE and calling the renderer with its
 * key — the UI row and the documentation entry then exist automatically. A
 * message body written inline at a call site is a bug: the owner cannot edit it
 * and nobody can find it.
 *
 * ── Placeholder rules ──────────────────────────────────────────────────────
 * Variables are `{camelCase}`, matching the `{name}` convention owners already
 * know from broadcast campaigns.
 *
 * A line is DROPPED from the message when every placeholder on it is empty AND
 * at least one of them is declared `optional` (see NotificationVariable). That
 * is what lets one editable body cover "with expiry date" and "without" without
 * asking owners to write conditionals — it reproduces the `.filter(Boolean)`
 * behaviour the hardcoded messages had, while keeping a greeting line alive when
 * the customer's name happens to be missing.
 */

export type NotificationAudience = 'customer' | 'staff' | 'owner';

export type NotificationCategory =
  | 'membership'
  | 'voucher'
  | 'transaction'
  | 'queue'
  | 'booking'
  | 'feedback'
  | 'account'
  | 'security'
  | 'marketing';

/** Human-readable category labels (Bahasa Indonesia — the owner's language). */
export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  membership: 'Membership',
  voucher: 'Voucher',
  transaction: 'Transaksi & Pembayaran',
  queue: 'Antrian',
  booking: 'Booking',
  feedback: 'Feedback & Ulasan',
  account: 'Akun Pelanggan',
  security: 'Keamanan & Persetujuan',
  marketing: 'Promo & Marketing',
};

export const AUDIENCE_LABELS: Record<NotificationAudience, string> = {
  customer: 'Pelanggan',
  staff: 'Kasir / Tim Cabang',
  owner: 'Pemilik',
};

export interface NotificationVariable {
  /** Placeholder name without braces, e.g. `customerName`. */
  name: string;
  /** What it holds, in the owner's language. */
  description: string;
  /** Shown in the editor preview so the owner sees a realistic message. */
  sample: string;
  /**
   * This variable is often absent, and a line built around it should VANISH
   * rather than be sent half-empty: "Berlaku sampai {expiryDate}." must not go
   * out as "Berlaku sampai ." for a voucher with no expiry.
   *
   * Optionality is declared here rather than inferred, because the two cases are
   * not distinguishable from the text. "Halo kak {customerName}!" also has an
   * empty variable sometimes, but that line must SURVIVE — the greeting is the
   * message. Marking only the genuinely conditional variables gets both right,
   * and the owner never has to learn a conditional syntax.
   */
  optional?: boolean;
}

export interface NotificationDefinition {
  key: string;
  /** Short name shown in the UI list and the document heading. */
  title: string;
  category: NotificationCategory;
  audience: NotificationAudience;
  /** What makes this message fire, in prose. Drives the doc's "Trigger" column. */
  trigger: string;
  variables: NotificationVariable[];
  defaultBody: string;
  /**
   * Whether the owner may switch this message off. Security codes and booking
   * acknowledgements are load-bearing — turning them off breaks a flow rather
   * than just going quiet — so they stay always-on.
   */
  canDisable: boolean;
  /**
   * Set when the wording must not be freely edited. One-time codes are the case:
   * the message carries a credential and an owner who deletes `{code}` silently
   * breaks login for every customer. Such entries are shown in the UI read-only.
   */
  lockedReason?: string;
  /** Not wired to any trigger yet — surfaced in the doc as "belum aktif". */
  inactive?: boolean;
}

const D = (d: NotificationDefinition) => d;

/**
 * Every notification, in the order the UI and the document present them.
 */
export const NOTIFICATION_CATALOG: NotificationDefinition[] = [
  // ── Membership ────────────────────────────────────────────────────────────
  D({
    key: 'membership_welcome',
    title: 'Membership aktif (selamat datang)',
    category: 'membership',
    audience: 'customer',
    trigger:
      'Saat pembayaran membership berhasil dan membership pelanggan aktif. Hanya dikirim bila paket membership tersebut mengaktifkan "kirim pesan selamat datang". Dikirim satu kali per membership.',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'planName', description: 'Nama paket membership', sample: 'Unlimited' },
      { name: 'endDate', description: 'Tanggal berakhir membership', sample: '06 September 2026', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! 🎉',
      'Selamat, membership *{planName}* kakak sudah aktif!',
      'Berlaku sampai {endDate}.',
      'Tinggal sebutkan nomor HP atau plat mobil kakak di kasir untuk pakai benefitnya ya 😊',
    ].join('\n'),
    canDisable: true,
  }),
  D({
    key: 'membership_expiry_reminder',
    title: 'Pengingat membership akan habis (H-30 / H-7 / hari-H)',
    category: 'membership',
    audience: 'customer',
    trigger:
      'Otomatis setiap 6 jam, sistem mencari membership aktif yang berakhir dalam 30 hari, 7 hari, atau hari ini, lalu mengirim pengingat. Setiap tahap hanya dikirim satu kali.',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'planName', description: 'Nama paket membership', sample: 'Unlimited' },
      {
        name: 'expiryPhrase',
        description: 'Keterangan waktu otomatis: "hari ini" atau "7 hari lagi"',
        sample: '7 hari lagi',
      },
      { name: 'endDate', description: 'Tanggal berakhir membership', sample: '06 September 2026', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! 🔔',
      'Membership *{planName}* kakak habis *{expiryPhrase}*.',
      'Berlaku sampai {endDate}.',
      'Mau kami bantu perpanjang sekarang biar benefitnya jalan terus? 😊',
    ].join('\n'),
    canDisable: true,
  }),

  // ── Voucher ───────────────────────────────────────────────────────────────
  D({
    key: 'voucher_purchased',
    title: 'Voucher dibeli — kode dikirim',
    category: 'voucher',
    audience: 'customer',
    trigger:
      'Saat pelanggan membeli paket voucher di kasir dan nomor HP-nya tercatat. Berisi seluruh kode voucher yang baru terbit.',
    variables: [
      { name: 'customerName', description: 'Nama pembeli', sample: 'Budi' },
      { name: 'voucherName', description: 'Nama paket voucher', sample: 'Paket Cuci 10x' },
      { name: 'codeCount', description: 'Jumlah kode voucher', sample: '10' },
      { name: 'codeList', description: 'Daftar kode voucher (otomatis, satu per baris)', sample: '1. AIRE-8F2K\n2. AIRE-9Q1M', optional: true },
      { name: 'expiryDate', description: 'Tanggal kedaluwarsa voucher (kosong bila tanpa batas)', sample: '31 Desember 2026', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! Terima kasih atas pembelian *{voucherName}* 🎫',
      '',
      'Berikut {codeCount} kode voucher yang bisa kakak gunakan:',
      '{codeList}',
      'Berlaku sampai {expiryDate}.',
      'Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊',
    ].join('\n'),
    canDisable: true,
  }),
  D({
    key: 'voucher_bonus_granted',
    title: 'Voucher bonus diberikan',
    category: 'voucher',
    audience: 'customer',
    trigger:
      'Saat pelanggan mendapat voucher bonus dari sebuah campaign/promo (bukan pembelian). Berisi kode voucher bonusnya.',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'voucherName', description: 'Nama paket voucher bonus', sample: 'Bonus Cuci Gratis' },
      { name: 'codeCount', description: 'Jumlah kode voucher', sample: '2' },
      { name: 'codeList', description: 'Daftar kode voucher (otomatis, satu per baris)', sample: '1. AIRE-BON1\n2. AIRE-BON2', optional: true },
      { name: 'expiryDate', description: 'Tanggal kedaluwarsa voucher (kosong bila tanpa batas)', sample: '31 Desember 2026', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! 🎉 Selamat, kakak dapat bonus *{voucherName}*!',
      '',
      'Berikut {codeCount} kode voucher yang bisa kakak gunakan:',
      '{codeList}',
      'Berlaku sampai {expiryDate}.',
      'Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊',
    ].join('\n'),
    canDisable: true,
  }),
  D({
    key: 'voucher_used',
    title: 'Voucher terpakai — sisa saldo',
    category: 'voucher',
    audience: 'customer',
    trigger:
      'Saat satu atau lebih kode voucher ditukarkan di kasir, dan masih ada sisa kode. Dikirim ke pemilik voucher.',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'voucherName', description: 'Nama paket voucher', sample: 'Paket Cuci 10x' },
      { name: 'usedDetail', description: 'Rincian pemakaian otomatis, mis. " (2 kode) di transaksi ORD-1042, hemat Rp100.000"', sample: ' di transaksi ORD-1042, hemat Rp50.000', optional: true },
      { name: 'remainingCount', description: 'Sisa kode voucher', sample: '8' },
      { name: 'remainingCodes', description: 'Daftar sisa kode (hanya untuk pemilik voucher)', sample: '1. AIRE-8F2K\n2. AIRE-9Q1M', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! 😊 Voucher *{voucherName}* berhasil digunakan{usedDetail}.',
      '',
      'Sisa voucher kakak: *{remainingCount}* kode',
      '{remainingCodes}',
      '',
      'Terima kasih ya kak! 🚗✨',
    ].join('\n'),
    canDisable: true,
  }),
  D({
    key: 'voucher_used_shared',
    title: 'Voucher terpakai — dipakai orang lain',
    category: 'voucher',
    audience: 'customer',
    trigger:
      'Ketika kode voucher ditukarkan oleh orang yang bukan pemilik voucher (voucher memang bisa dibagikan). Penerima hanya diberi tahu jumlah sisanya — daftar kodenya tidak ikut dikirim karena itu milik orang lain.',
    variables: [
      { name: 'voucherName', description: 'Nama paket voucher', sample: 'Paket Cuci 10x' },
      { name: 'usedDetail', description: 'Rincian pemakaian otomatis', sample: ' di transaksi ORD-1042, hemat Rp50.000', optional: true },
      { name: 'remainingCount', description: 'Sisa kode voucher', sample: '8' },
    ],
    defaultBody: [
      'Halo kak! 😊 Voucher *{voucherName}* berhasil digunakan{usedDetail}.',
      '',
      'Sisa voucher: *{remainingCount}* kode.',
      '',
      'Terima kasih ya kak! 🚗✨',
    ].join('\n'),
    canDisable: true,
  }),
  D({
    key: 'voucher_used_last',
    title: 'Voucher terpakai — kode habis',
    category: 'voucher',
    audience: 'customer',
    trigger: 'Sama seperti di atas, tetapi dikirim ketika kode voucher pelanggan sudah habis semua.',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'voucherName', description: 'Nama paket voucher', sample: 'Paket Cuci 10x' },
      { name: 'usedDetail', description: 'Rincian pemakaian otomatis', sample: ' di transaksi ORD-1042, hemat Rp50.000', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! 😊 Voucher *{voucherName}* berhasil digunakan{usedDetail}.',
      '',
      'Voucher kakak sudah terpakai semua ya 🙏 Kalau mau beli lagi, tinggal bilang ke kami aja kak!',
      '',
      'Terima kasih ya kak! 🚗✨',
    ].join('\n'),
    canDisable: true,
  }),

  // ── Transaksi ─────────────────────────────────────────────────────────────
  D({
    key: 'payment_receipt',
    title: 'Struk / invoice setelah pembayaran',
    category: 'transaction',
    audience: 'customer',
    trigger:
      'Saat pesanan selesai dibayar dan nomor HP pelanggan tercatat. Berisi tautan struk digital yang bisa dibuka pelanggan.',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'orderNumber', description: 'Nomor pesanan', sample: 'ORD-1042' },
      { name: 'total', description: 'Total pembayaran', sample: 'Rp150.000' },
      { name: 'receiptUrl', description: 'Tautan struk digital', sample: 'https://app.useairin.id/receipt/abc123' },
    ],
    defaultBody: [
      // Name first: with no name on the order this degrades to "Halo, terima
      // kasih…" (the space-before-punctuation cleanup removes the seam), whereas
      // a trailing "…Anda, 🙏" would look broken.
      'Halo {customerName}, terima kasih atas pembayaran Anda 🙏',
      'Pesanan {orderNumber} — Total {total}.',
      'Lihat invoice: {receiptUrl}',
    ].join('\n'),
    canDisable: true,
  }),

  // ── Antrian ───────────────────────────────────────────────────────────────
  D({
    key: 'queue_completion',
    title: 'Mobil selesai dicuci',
    category: 'queue',
    audience: 'customer',
    trigger:
      'Saat kasir menandai mobil di papan antrian sebagai "selesai" dan nomor HP pelanggan tercatat.',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'plate', description: 'Plat nomor kendaraan', sample: 'B 1234 XYZ', optional: true },
      { name: 'outletName', description: 'Nama cabang', sample: 'Kencana Loka', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! ✨',
      'Mobil kakak sudah selesai dicuci 🚗',
      'Plat: {plate}',
      'Cabang: {outletName}',
      'Silakan menuju kasir ya kak. Terima kasih!',
    ].join('\n'),
    canDisable: true,
  }),

  // ── Booking ───────────────────────────────────────────────────────────────
  D({
    key: 'booking_received',
    title: 'Permintaan booking diterima',
    category: 'booking',
    audience: 'customer',
    trigger: 'Saat pelanggan mengajukan booking lewat WhatsApp dan permintaannya menunggu konfirmasi tim.',
    variables: [
      { name: 'bookingSummary', description: 'Ringkasan booking (layanan, waktu)', sample: 'Cuci Premium · 10 Agustus 2026 14:00', optional: true },
    ],
    defaultBody: [
      'Terima kasih! Permintaan booking Anda kami terima ✅',
      '{bookingSummary}',
      'Menunggu konfirmasi akhir dari tim kami — Anda akan kami kabari.',
    ].join('\n'),
    canDisable: false,
  }),
  D({
    key: 'booking_confirmed',
    title: 'Booking dikonfirmasi',
    category: 'booking',
    audience: 'customer',
    trigger:
      'Saat tim cabang menyetujui booking — baik lewat balasan WhatsApp maupun lewat tautan konfirmasi dari portal pelanggan.',
    variables: [
      { name: 'bookingSummary', description: 'Ringkasan booking (layanan, waktu)', sample: 'Cuci Premium · 10 Agustus 2026 14:00', optional: true },
    ],
    defaultBody: [
      'Booking Anda telah DIKONFIRMASI tim kami ✅',
      '{bookingSummary}',
      'Sampai jumpa!',
    ].join('\n'),
    canDisable: false,
  }),
  D({
    key: 'booking_rejected',
    title: 'Booking ditolak',
    category: 'booking',
    audience: 'customer',
    trigger: 'Saat tim cabang menolak permintaan booking pelanggan.',
    variables: [
      { name: 'bookingSummary', description: 'Ringkasan booking (layanan, waktu)', sample: 'Cuci Premium · 10 Agustus 2026 14:00', optional: true },
    ],
    defaultBody: [
      'Maaf, booking Anda belum dapat kami konfirmasi 🙏',
      '{bookingSummary}',
      'Silakan hubungi kami atau coba pilih waktu lain ya.',
    ].join('\n'),
    canDisable: false,
  }),
  D({
    key: 'booking_expired',
    title: 'Booking kedaluwarsa otomatis',
    category: 'booking',
    audience: 'customer',
    trigger:
      'Saat permintaan booking tidak dikonfirmasi tim sampai batas waktunya, sistem membatalkannya otomatis dan mengabari pelanggan.',
    variables: [
      { name: 'bookingSummary', description: 'Ringkasan booking (layanan, waktu)', sample: 'Cuci Premium · 10 Agustus 2026 14:00', optional: true },
    ],
    defaultBody: [
      'Halo kak, maaf banget ya 🙏 Booking kakak ({bookingSummary}) belum sempat tim kami konfirmasi jadi otomatis kedaluwarsa.',
      'Kalau masih mau dijadwalkan, chat kami aja ya — nanti kami bantu atur ulang 😊',
    ].join('\n'),
    canDisable: true,
  }),
  D({
    key: 'booking_approval_request',
    title: 'Permintaan booking baru (untuk tim)',
    category: 'booking',
    audience: 'staff',
    trigger:
      'Saat ada permintaan booking lewat WhatsApp. Dikirim ke nomor eskalasi tim agar bisa dibalas TERIMA / TOLAK.',
    variables: [
      { name: 'ref', description: 'Kode referensi booking untuk dibalas', sample: 'B7K2' },
      { name: 'bookingSummary', description: 'Ringkasan booking', sample: 'Cuci Premium · 10 Agustus 2026 14:00', optional: true },
      { name: 'customerPhone', description: 'Nomor HP pelanggan', sample: '628123456789' },
    ],
    defaultBody: [
      '🆕 Booking baru menunggu persetujuan [{ref}]:',
      '{bookingSummary}',
      'Pelanggan: {customerPhone}',
      '',
      'Balas TERIMA {ref} untuk konfirmasi atau TOLAK {ref} untuk menolak.',
    ].join('\n'),
    canDisable: false,
  }),
  D({
    key: 'booking_branch_alert',
    title: 'Booking baru dari portal pelanggan (untuk cabang)',
    category: 'booking',
    audience: 'staff',
    trigger:
      'Saat pelanggan membuat booking lewat portal/aplikasi. Dikirim ke nomor WhatsApp cabang beserta tautan konfirmasi.',
    variables: [
      { name: 'outletName', description: 'Nama cabang', sample: 'Kencana Loka' },
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'plate', description: 'Plat nomor kendaraan', sample: 'B 1234 XYZ', optional: true },
      { name: 'serviceName', description: 'Layanan yang dipesan', sample: 'Cuci Premium', optional: true },
      { name: 'scheduledAt', description: 'Waktu booking', sample: '10 Agu 2026, 14.00' },
      { name: 'confirmUrl', description: 'Tautan konfirmasi / tolak', sample: 'https://app.useairin.id/confirm-booking/abc123' },
    ],
    defaultBody: [
      '📅 *Booking baru* — {outletName}',
      '{customerName}',
      'Plat: {plate}',
      'Layanan: {serviceName}',
      'Waktu: {scheduledAt}',
      '',
      'Konfirmasi / tolak: {confirmUrl}',
    ].join('\n'),
    canDisable: false,
  }),

  // ── Feedback ──────────────────────────────────────────────────────────────
  D({
    key: 'feedback_request',
    title: 'Permintaan ulasan / feedback',
    category: 'feedback',
    audience: 'customer',
    trigger:
      'Setelah transaksi selesai, sesuai jeda waktu yang diatur di halaman Feedback (langsung atau tertunda beberapa menit).',
    variables: [
      { name: 'thanksMessage', description: 'Kalimat pembuka dari pengaturan Feedback', sample: 'Terima kasih sudah mampir! Bagaimana layanan kami?' },
      { name: 'feedbackUrl', description: 'Tautan formulir ulasan', sample: 'https://app.useairin.id/feedback/abc123' },
    ],
    defaultBody: ['{thanksMessage}', '{feedbackUrl}'].join('\n'),
    canDisable: true,
  }),

  // ── Akun pelanggan ────────────────────────────────────────────────────────
  D({
    key: 'portal_login_otp',
    title: 'Kode masuk akun pelanggan (OTP)',
    category: 'account',
    audience: 'customer',
    trigger: 'Saat pelanggan meminta kode masuk ke portal/aplikasi pelanggan. Berlaku 5 menit.',
    variables: [
      { name: 'code', description: 'Kode OTP 6 digit', sample: '482915' },
    ],
    defaultBody: ['Kode masuk akun Anda: *{code}*', 'Berlaku 5 menit. Jangan bagikan kode ini kepada siapa pun.'].join('\n'),
    canDisable: false,
    lockedReason:
      'Pesan ini membawa kode keamanan. Mengubahnya berisiko membuat pelanggan gagal masuk, jadi teksnya dikunci.',
  }),
  D({
    key: 'customer_linked_ack',
    title: 'Nomor WhatsApp berhasil dikenali',
    category: 'account',
    audience: 'customer',
    trigger:
      'Saat pelanggan yang chat lewat WhatsApp berhasil dicocokkan dengan datanya di sistem, sehingga asisten bisa mengecek membership/voucher miliknya.',
    variables: [{ name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' }],
    defaultBody:
      'Makasih kak {customerName}! 😊 Sekarang kami sudah bisa bantu cek membership, voucher, atau booking kakak. Ada yang bisa dibantu?',
    canDisable: true,
  }),

  // ── Keamanan & persetujuan ────────────────────────────────────────────────
  D({
    key: 'escalation_ack',
    title: 'Percakapan diteruskan ke tim (balasan ke pelanggan)',
    category: 'security',
    audience: 'customer',
    trigger: 'Saat asisten WhatsApp menyerahkan percakapan ke tim manusia.',
    variables: [],
    defaultBody:
      'Baik kak, ini kami teruskan dulu ke tim biar dibantu lebih lanjut ya 🙏 Mohon tunggu sebentar, nanti tim langsung menghubungi kakak. Sambil menunggu, ada lagi yang bisa dibantu? 😊',
    canDisable: false,
  }),
  D({
    key: 'escalation_alert',
    title: 'Peringatan eskalasi (untuk tim)',
    category: 'security',
    audience: 'staff',
    trigger: 'Bersamaan dengan pesan di atas, dikirim ke nomor eskalasi tim yang diatur di pengaturan asisten.',
    variables: [
      { name: 'from', description: 'Nomor HP pelanggan', sample: '628123456789', optional: true },
      { name: 'reason', description: 'Alasan eskalasi', sample: 'Pelanggan minta bicara dengan staf', optional: true },
    ],
    defaultBody: [
      '🚨 *Percakapan dieskalasi ke tim*',
      'Dari: {from}',
      'Alasan: {reason}',
      'Silakan balas customer ini langsung ya.',
    ].join('\n'),
    canDisable: false,
  }),
  D({
    key: 'refund_pin',
    title: 'Kode PIN refund',
    category: 'security',
    audience: 'owner',
    trigger:
      'Saat kasir mengajukan refund. Kode dikirim ke nomor eskalasi tenant agar refund hanya bisa disetujui pemilik.',
    variables: [
      { name: 'orderNumber', description: 'Nomor pesanan', sample: 'ORD-1042' },
      { name: 'pin', description: 'Kode PIN sekali pakai', sample: '482915' },
      { name: 'ttlMinutes', description: 'Masa berlaku kode (menit)', sample: '10' },
    ],
    defaultBody: [
      'Kode PIN refund untuk order {orderNumber}: {pin}',
      '',
      'Berlaku {ttlMinutes} menit. Jangan bagikan kode ini kepada siapa pun.',
    ].join('\n'),
    canDisable: false,
    lockedReason: 'Pesan ini membawa kode persetujuan refund. Teksnya dikunci demi keamanan.',
  }),
  D({
    key: 'void_pin',
    title: 'Kode PIN pembatalan transaksi (void)',
    category: 'security',
    audience: 'owner',
    trigger: 'Saat kasir mengajukan pembatalan transaksi. Kode dikirim ke nomor WhatsApp pemilik.',
    variables: [
      { name: 'context', description: 'Rincian transaksi yang akan dibatalkan', sample: 'ORD-1042 · Rp150.000 · Kasir Andi' },
      { name: 'pin', description: 'Kode PIN sekali pakai', sample: '482915' },
      { name: 'ttlMinutes', description: 'Masa berlaku kode (menit)', sample: '10' },
    ],
    defaultBody: [
      'Permintaan VOID (refund) perlu persetujuan Anda.',
      '',
      '{context}',
      '',
      'Kode PIN: {pin}',
      'Berlaku {ttlMinutes} menit. Berikan kode ini hanya jika Anda menyetujui pembatalan di atas.',
    ].join('\n'),
    canDisable: false,
    lockedReason: 'Pesan ini membawa kode persetujuan pembatalan. Teksnya dikunci demi keamanan.',
  }),
  D({
    key: 'action_proposal_pending',
    title: 'Usulan tindakan AI menunggu persetujuan',
    category: 'security',
    audience: 'owner',
    trigger: 'Saat asisten AI mengusulkan sebuah tindakan yang butuh persetujuan pemilik.',
    variables: [
      { name: 'actionType', description: 'Jenis tindakan yang diusulkan', sample: 'Kirim promo ke pelanggan lama', optional: true },
      { name: 'reasoning', description: 'Alasan AI', sample: 'Ada 42 pelanggan tidak kembali selama 60 hari', optional: true },
      { name: 'confidence', description: 'Tingkat keyakinan AI', sample: '78%', optional: true },
    ],
    defaultBody: [
      '🤖 *Usulan tindakan menunggu persetujuan*',
      'Tindakan: {actionType}',
      'Alasan: {reasoning}',
      'Keyakinan: {confidence}',
      'Buka dashboard untuk menyetujui atau menolak.',
    ].join('\n'),
    canDisable: true,
  }),

  // ── Promo & marketing ─────────────────────────────────────────────────────
  D({
    key: 'campaign_bonus',
    title: 'Pesan campaign / promo dari AI',
    category: 'marketing',
    audience: 'customer',
    trigger:
      'Saat asisten AI menjalankan campaign ke segmen pelanggan tertentu (fitur ini harus diaktifkan dulu di pengaturan otomatisasi).',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'campaignName', description: 'Nama campaign', sample: 'Promo Akhir Pekan' },
      { name: 'codes', description: 'Kode voucher bila ada', sample: 'AIRE-PROMO1', optional: true },
      { name: 'expiryDate', description: 'Tanggal kedaluwarsa bila ada', sample: '31 Agustus 2026', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! 🎉',
      'Ada promo spesial buat kakak: *{campaignName}*!',
      'Kode voucher kakak: {codes}',
      'Berlaku sampai {expiryDate}.',
      'Kalau mau tanya-tanya dulu, balas aja pesan ini ya kak 😊',
    ].join('\n'),
    canDisable: true,
  }),
  D({
    key: 'retention_offer',
    title: 'Penawaran untuk pelanggan lama (retensi)',
    category: 'marketing',
    audience: 'customer',
    trigger:
      'Saat asisten AI mendeteksi pelanggan sudah lama tidak datang dan mengirim penawaran (butuh toggle "retention offers" aktif).',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'offer', description: 'Isi penawaran', sample: 'diskon 20% untuk cuci berikutnya', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! 😊',
      'Sudah lama nih kakak nggak mampir — kami kangen mobil kakak!',
      'Ada penawaran khusus buat kakak: {offer}',
      'Mau kami bantu jadwalkan cuci berikutnya?',
    ].join('\n'),
    canDisable: true,
  }),
  D({
    key: 'membership_recommendation',
    title: 'Rekomendasi membership dari AI',
    category: 'marketing',
    audience: 'customer',
    trigger:
      'Saat asisten AI melihat pola cuci pelanggan lebih hemat bila memakai membership (butuh toggle "membership recommendations" aktif).',
    variables: [
      { name: 'customerName', description: 'Nama pelanggan', sample: 'Budi' },
      { name: 'offer', description: 'Isi rekomendasi', sample: 'Paket Unlimited hemat ±Rp200.000/bulan', optional: true },
    ],
    defaultBody: [
      'Halo kak {customerName}! 😊',
      'Dari pola cuci kakak, ada paket membership yang kelihatannya lebih hemat nih.',
      '{offer}',
      'Mau kami jelaskan detailnya kak?',
    ].join('\n'),
    canDisable: true,
  }),
];

/** Fast key lookup. */
export const CATALOG_BY_KEY: ReadonlyMap<string, NotificationDefinition> = new Map(
  NOTIFICATION_CATALOG.map((d) => [d.key, d]),
);

export function getDefinition(key: string): NotificationDefinition | undefined {
  return CATALOG_BY_KEY.get(key);
}

/** Every `{placeholder}` used in a body, in order of first appearance. */
export function extractPlaceholders(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)) {
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/**
 * Placeholders an owner typed that this notification does not provide. A body
 * containing one would ship `{namaPelanggan}` verbatim to a customer, so the
 * editor rejects it rather than saving.
 */
export function unknownPlaceholders(key: string, body: string): string[] {
  const def = getDefinition(key);
  if (!def) return [];
  const allowed = new Set(def.variables.map((v) => v.name));
  return extractPlaceholders(body).filter((p) => !allowed.has(p));
}
