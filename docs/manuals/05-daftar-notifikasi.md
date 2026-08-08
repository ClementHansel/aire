# Daftar Notifikasi Otomatis

Dokumen ini memuat **semua pesan otomatis** yang dikirim sistem atas nama Anda: kapan pesan itu dikirim (trigger), siapa penerimanya, dan apa isinya.

Semua teks di bawah ini **dapat Anda ubah sendiri** lewat menu **Pengaturan → Notifications** di dashboard, tanpa perlu menghubungi tim teknis. Di sana Anda juga bisa mematikan sebagian notifikasi, melihat pratinjau, dan mengirim uji coba ke nomor Anda.

> ⚙️ Dokumen ini dihasilkan otomatis dari konfigurasi sistem, jadi isinya selalu sama dengan yang benar-benar dikirim.

## Cara membaca variabel

Kata di dalam kurung kurawal seperti `{customerName}` adalah **variabel** — sistem menggantinya dengan data asli saat pesan dikirim.

- `Halo kak {customerName}!` → `Halo kak Budi!`
- Variabel bertanda **opsional** kadang kosong (misalnya voucher tanpa tanggal kedaluwarsa). Bila kosong, **seluruh baris yang memakai variabel itu otomatis hilang** — jadi pelanggan tidak pernah menerima kalimat setengah jadi seperti "Berlaku sampai ."
- Anda hanya boleh memakai variabel yang terdaftar pada masing-masing notifikasi. Variabel lain akan ditolak saat disimpan.

## Ringkasan

| # | Notifikasi | Penerima | Trigger singkat | Bisa dimatikan? |
|---|---|---|---|---|
| 1 | [Membership aktif (selamat datang)](#membership-aktif-selamat-datang) | Pelanggan | Saat pembayaran membership berhasil dan membership pelanggan aktif. | Ya |
| 2 | [Pengingat membership akan habis (H-30 / H-7 / hari-H)](#pengingat-membership-akan-habis-h-30-h-7-hari-h) | Pelanggan | Otomatis setiap 6 jam, sistem mencari membership aktif yang berakhir dalam 30 hari, 7 hari, atau hari ini, lalu mengirim pengingat. | Ya |
| 3 | [Voucher dibeli — kode dikirim](#voucher-dibeli-kode-dikirim) | Pelanggan | Saat pelanggan membeli paket voucher di kasir dan nomor HP-nya tercatat. | Ya |
| 4 | [Voucher bonus diberikan](#voucher-bonus-diberikan) | Pelanggan | Saat pelanggan mendapat voucher bonus dari sebuah campaign/promo (bukan pembelian). | Ya |
| 5 | [Voucher terpakai — sisa saldo](#voucher-terpakai-sisa-saldo) | Pelanggan | Saat satu atau lebih kode voucher ditukarkan di kasir, dan masih ada sisa kode. | Ya |
| 6 | [Voucher terpakai — dipakai orang lain](#voucher-terpakai-dipakai-orang-lain) | Pelanggan | Ketika kode voucher ditukarkan oleh orang yang bukan pemilik voucher (voucher memang bisa dibagikan). | Ya |
| 7 | [Voucher terpakai — kode habis](#voucher-terpakai-kode-habis) | Pelanggan | Sama seperti di atas, tetapi dikirim ketika kode voucher pelanggan sudah habis semua. | Ya |
| 8 | [Struk / invoice setelah pembayaran](#struk-invoice-setelah-pembayaran) | Pelanggan | Saat pesanan selesai dibayar dan nomor HP pelanggan tercatat. | Ya |
| 9 | [Mobil selesai dicuci](#mobil-selesai-dicuci) | Pelanggan | Saat kasir menandai mobil di papan antrian sebagai "selesai" dan nomor HP pelanggan tercatat. | Ya |
| 10 | [Permintaan booking diterima](#permintaan-booking-diterima) | Pelanggan | Saat pelanggan mengajukan booking lewat WhatsApp dan permintaannya menunggu konfirmasi tim. | Tidak |
| 11 | [Booking dikonfirmasi](#booking-dikonfirmasi) | Pelanggan | Saat tim cabang menyetujui booking — baik lewat balasan WhatsApp maupun lewat tautan konfirmasi dari portal pelanggan. | Tidak |
| 12 | [Booking ditolak](#booking-ditolak) | Pelanggan | Saat tim cabang menolak permintaan booking pelanggan. | Tidak |
| 13 | [Booking kedaluwarsa otomatis](#booking-kedaluwarsa-otomatis) | Pelanggan | Saat permintaan booking tidak dikonfirmasi tim sampai batas waktunya, sistem membatalkannya otomatis dan mengabari pelanggan. | Ya |
| 14 | [Permintaan booking baru (untuk tim)](#permintaan-booking-baru-untuk-tim) | Kasir / Tim Cabang | Saat ada permintaan booking lewat WhatsApp. | Tidak |
| 15 | [Booking baru dari portal pelanggan (untuk cabang)](#booking-baru-dari-portal-pelanggan-untuk-cabang) | Kasir / Tim Cabang | Saat pelanggan membuat booking lewat portal/aplikasi. | Tidak |
| 16 | [Permintaan ulasan / feedback](#permintaan-ulasan-feedback) | Pelanggan | Setelah transaksi selesai, sesuai jeda waktu yang diatur di halaman Feedback (langsung atau tertunda beberapa menit). | Ya |
| 17 | [Kode masuk akun pelanggan (OTP)](#kode-masuk-akun-pelanggan-otp) | Pelanggan | Saat pelanggan meminta kode masuk ke portal/aplikasi pelanggan. | 🔒 Terkunci |
| 18 | [Nomor WhatsApp berhasil dikenali](#nomor-whatsapp-berhasil-dikenali) | Pelanggan | Saat pelanggan yang chat lewat WhatsApp berhasil dicocokkan dengan datanya di sistem, sehingga asisten bisa mengecek membership/voucher miliknya. | Ya |
| 19 | [Percakapan diteruskan ke tim (balasan ke pelanggan)](#percakapan-diteruskan-ke-tim-balasan-ke-pelanggan) | Pelanggan | Saat asisten WhatsApp menyerahkan percakapan ke tim manusia. | Tidak |
| 20 | [Peringatan eskalasi (untuk tim)](#peringatan-eskalasi-untuk-tim) | Kasir / Tim Cabang | Bersamaan dengan pesan di atas, dikirim ke nomor eskalasi tim yang diatur di pengaturan asisten. | Tidak |
| 21 | [Kode PIN refund](#kode-pin-refund) | Pemilik | Saat kasir mengajukan refund. | 🔒 Terkunci |
| 22 | [Kode PIN pembatalan transaksi (void)](#kode-pin-pembatalan-transaksi-void) | Pemilik | Saat kasir mengajukan pembatalan transaksi. | 🔒 Terkunci |
| 23 | [Usulan tindakan AI menunggu persetujuan](#usulan-tindakan-ai-menunggu-persetujuan) | Pemilik | Saat asisten AI mengusulkan sebuah tindakan yang butuh persetujuan pemilik. | Ya |
| 24 | [Pesan campaign / promo dari AI](#pesan-campaign-promo-dari-ai) | Pelanggan | Saat asisten AI menjalankan campaign ke segmen pelanggan tertentu (fitur ini harus diaktifkan dulu di pengaturan otomatisasi). | Ya |
| 25 | [Penawaran untuk pelanggan lama (retensi)](#penawaran-untuk-pelanggan-lama-retensi) | Pelanggan | Saat asisten AI mendeteksi pelanggan sudah lama tidak datang dan mengirim penawaran (butuh toggle "retention offers" aktif). | Ya |
| 26 | [Rekomendasi membership dari AI](#rekomendasi-membership-dari-ai) | Pelanggan | Saat asisten AI melihat pola cuci pelanggan lebih hemat bila memakai membership (butuh toggle "membership recommendations" aktif). | Ya |

## Membership

### Membership aktif (selamat datang)

**Penerima:** Pelanggan

**Trigger:** Saat pembayaran membership berhasil dan membership pelanggan aktif. Hanya dikirim bila paket membership tersebut mengaktifkan "kirim pesan selamat datang". Dikirim satu kali per membership.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{planName}` | Nama paket membership | Unlimited | — |
| `{endDate}` | Tanggal berakhir membership | 06 September 2026 | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! 🎉
Selamat, membership *{planName}* kakak sudah aktif!
Berlaku sampai {endDate}.
Tinggal sebutkan nomor HP atau plat mobil kakak di kasir untuk pakai benefitnya ya 😊
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! 🎉
Selamat, membership *Unlimited* kakak sudah aktif!
Berlaku sampai 06 September 2026.
Tinggal sebutkan nomor HP atau plat mobil kakak di kasir untuk pakai benefitnya ya 😊
```

### Pengingat membership akan habis (H-30 / H-7 / hari-H)

**Penerima:** Pelanggan

**Trigger:** Otomatis setiap 6 jam, sistem mencari membership aktif yang berakhir dalam 30 hari, 7 hari, atau hari ini, lalu mengirim pengingat. Setiap tahap hanya dikirim satu kali.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{planName}` | Nama paket membership | Unlimited | — |
| `{expiryPhrase}` | Keterangan waktu otomatis: "hari ini" atau "7 hari lagi" | 7 hari lagi | — |
| `{endDate}` | Tanggal berakhir membership | 06 September 2026 | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! 🔔
Membership *{planName}* kakak habis *{expiryPhrase}*.
Berlaku sampai {endDate}.
Mau kami bantu perpanjang sekarang biar benefitnya jalan terus? 😊
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! 🔔
Membership *Unlimited* kakak habis *7 hari lagi*.
Berlaku sampai 06 September 2026.
Mau kami bantu perpanjang sekarang biar benefitnya jalan terus? 😊
```

## Voucher

### Voucher dibeli — kode dikirim

**Penerima:** Pelanggan

**Trigger:** Saat pelanggan membeli paket voucher di kasir dan nomor HP-nya tercatat. Berisi seluruh kode voucher yang baru terbit.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pembeli | Budi | — |
| `{voucherName}` | Nama paket voucher | Paket Cuci 10x | — |
| `{codeCount}` | Jumlah kode voucher | 10 | — |
| `{codeList}` | Daftar kode voucher (otomatis, satu per baris) | 1. AIRE-8F2K / 2. AIRE-9Q1M | Ya |
| `{expiryDate}` | Tanggal kedaluwarsa voucher (kosong bila tanpa batas) | 31 Desember 2026 | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! Terima kasih atas pembelian *{voucherName}* 🎫

Berikut {codeCount} kode voucher yang bisa kakak gunakan:
{codeList}
Berlaku sampai {expiryDate}.
Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! Terima kasih atas pembelian *Paket Cuci 10x* 🎫

Berikut 10 kode voucher yang bisa kakak gunakan:
1. AIRE-8F2K
2. AIRE-9Q1M
Berlaku sampai 31 Desember 2026.
Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊
```

### Voucher bonus diberikan

**Penerima:** Pelanggan

**Trigger:** Saat pelanggan mendapat voucher bonus dari sebuah campaign/promo (bukan pembelian). Berisi kode voucher bonusnya.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{voucherName}` | Nama paket voucher bonus | Bonus Cuci Gratis | — |
| `{codeCount}` | Jumlah kode voucher | 2 | — |
| `{codeList}` | Daftar kode voucher (otomatis, satu per baris) | 1. AIRE-BON1 / 2. AIRE-BON2 | Ya |
| `{expiryDate}` | Tanggal kedaluwarsa voucher (kosong bila tanpa batas) | 31 Desember 2026 | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! 🎉 Selamat, kakak dapat bonus *{voucherName}*!

Berikut {codeCount} kode voucher yang bisa kakak gunakan:
{codeList}
Berlaku sampai {expiryDate}.
Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! 🎉 Selamat, kakak dapat bonus *Bonus Cuci Gratis*!

Berikut 2 kode voucher yang bisa kakak gunakan:
1. AIRE-BON1
2. AIRE-BON2
Berlaku sampai 31 Desember 2026.
Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊
```

### Voucher terpakai — sisa saldo

**Penerima:** Pelanggan

**Trigger:** Saat satu atau lebih kode voucher ditukarkan di kasir, dan masih ada sisa kode. Dikirim ke pemilik voucher.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{voucherName}` | Nama paket voucher | Paket Cuci 10x | — |
| `{usedDetail}` | Rincian pemakaian otomatis, mis. " (2 kode) di transaksi ORD-1042, hemat Rp100.000" |  di transaksi ORD-1042, hemat Rp50.000 | Ya |
| `{remainingCount}` | Sisa kode voucher | 8 | — |
| `{remainingCodes}` | Daftar sisa kode (hanya untuk pemilik voucher) | 1. AIRE-8F2K / 2. AIRE-9Q1M | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! 😊 Voucher *{voucherName}* berhasil digunakan{usedDetail}.

Sisa voucher kakak: *{remainingCount}* kode
{remainingCodes}

Terima kasih ya kak! 🚗✨
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! 😊 Voucher *Paket Cuci 10x* berhasil digunakan di transaksi ORD-1042, hemat Rp50.000.

Sisa voucher kakak: *8* kode
1. AIRE-8F2K
2. AIRE-9Q1M

Terima kasih ya kak! 🚗✨
```

### Voucher terpakai — dipakai orang lain

**Penerima:** Pelanggan

**Trigger:** Ketika kode voucher ditukarkan oleh orang yang bukan pemilik voucher (voucher memang bisa dibagikan). Penerima hanya diberi tahu jumlah sisanya — daftar kodenya tidak ikut dikirim karena itu milik orang lain.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{voucherName}` | Nama paket voucher | Paket Cuci 10x | — |
| `{usedDetail}` | Rincian pemakaian otomatis |  di transaksi ORD-1042, hemat Rp50.000 | Ya |
| `{remainingCount}` | Sisa kode voucher | 8 | — |

**Isi pesan (bawaan):**

```text
Halo kak! 😊 Voucher *{voucherName}* berhasil digunakan{usedDetail}.

Sisa voucher: *{remainingCount}* kode.

Terima kasih ya kak! 🚗✨
```

**Contoh hasil yang diterima:**

```text
Halo kak! 😊 Voucher *Paket Cuci 10x* berhasil digunakan di transaksi ORD-1042, hemat Rp50.000.

Sisa voucher: *8* kode.

Terima kasih ya kak! 🚗✨
```

### Voucher terpakai — kode habis

**Penerima:** Pelanggan

**Trigger:** Sama seperti di atas, tetapi dikirim ketika kode voucher pelanggan sudah habis semua.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{voucherName}` | Nama paket voucher | Paket Cuci 10x | — |
| `{usedDetail}` | Rincian pemakaian otomatis |  di transaksi ORD-1042, hemat Rp50.000 | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! 😊 Voucher *{voucherName}* berhasil digunakan{usedDetail}.

Voucher kakak sudah terpakai semua ya 🙏 Kalau mau beli lagi, tinggal bilang ke kami aja kak!

Terima kasih ya kak! 🚗✨
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! 😊 Voucher *Paket Cuci 10x* berhasil digunakan di transaksi ORD-1042, hemat Rp50.000.

Voucher kakak sudah terpakai semua ya 🙏 Kalau mau beli lagi, tinggal bilang ke kami aja kak!

Terima kasih ya kak! 🚗✨
```

## Transaksi & Pembayaran

### Struk / invoice setelah pembayaran

**Penerima:** Pelanggan

**Trigger:** Saat pesanan selesai dibayar dan nomor HP pelanggan tercatat. Berisi tautan struk digital yang bisa dibuka pelanggan.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{orderNumber}` | Nomor pesanan | ORD-1042 | — |
| `{total}` | Total pembayaran | Rp150.000 | — |
| `{receiptUrl}` | Tautan struk digital | https://app.useairin.id/receipt/abc123 | — |

**Isi pesan (bawaan):**

```text
Halo {customerName}, terima kasih atas pembayaran Anda 🙏
Pesanan {orderNumber} — Total {total}.
Lihat invoice: {receiptUrl}
```

**Contoh hasil yang diterima:**

```text
Halo Budi, terima kasih atas pembayaran Anda 🙏
Pesanan ORD-1042 — Total Rp150.000.
Lihat invoice: https://app.useairin.id/receipt/abc123
```

## Antrian

### Mobil selesai dicuci

**Penerima:** Pelanggan

**Trigger:** Saat kasir menandai mobil di papan antrian sebagai "selesai" dan nomor HP pelanggan tercatat.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{plate}` | Plat nomor kendaraan | B 1234 XYZ | Ya |
| `{outletName}` | Nama cabang | Kencana Loka | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! ✨
Mobil kakak sudah selesai dicuci 🚗
Plat: {plate}
Cabang: {outletName}
Silakan menuju kasir ya kak. Terima kasih!
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! ✨
Mobil kakak sudah selesai dicuci 🚗
Plat: B 1234 XYZ
Cabang: Kencana Loka
Silakan menuju kasir ya kak. Terima kasih!
```

## Booking

### Permintaan booking diterima

**Penerima:** Pelanggan

**Trigger:** Saat pelanggan mengajukan booking lewat WhatsApp dan permintaannya menunggu konfirmasi tim.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{bookingSummary}` | Ringkasan booking (layanan, waktu) | Cuci Premium · 10 Agustus 2026 14:00 | Ya |

**Isi pesan (bawaan):**

```text
Terima kasih! Permintaan booking Anda kami terima ✅
{bookingSummary}
Menunggu konfirmasi akhir dari tim kami — Anda akan kami kabari.
```

**Contoh hasil yang diterima:**

```text
Terima kasih! Permintaan booking Anda kami terima ✅
Cuci Premium · 10 Agustus 2026 14:00
Menunggu konfirmasi akhir dari tim kami — Anda akan kami kabari.
```

> ℹ️ Teks bisa diubah, tetapi notifikasi ini tidak bisa dimatikan karena dibutuhkan oleh alur transaksi.

### Booking dikonfirmasi

**Penerima:** Pelanggan

**Trigger:** Saat tim cabang menyetujui booking — baik lewat balasan WhatsApp maupun lewat tautan konfirmasi dari portal pelanggan.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{bookingSummary}` | Ringkasan booking (layanan, waktu) | Cuci Premium · 10 Agustus 2026 14:00 | Ya |

**Isi pesan (bawaan):**

```text
Booking Anda telah DIKONFIRMASI tim kami ✅
{bookingSummary}
Sampai jumpa!
```

**Contoh hasil yang diterima:**

```text
Booking Anda telah DIKONFIRMASI tim kami ✅
Cuci Premium · 10 Agustus 2026 14:00
Sampai jumpa!
```

> ℹ️ Teks bisa diubah, tetapi notifikasi ini tidak bisa dimatikan karena dibutuhkan oleh alur transaksi.

### Booking ditolak

**Penerima:** Pelanggan

**Trigger:** Saat tim cabang menolak permintaan booking pelanggan.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{bookingSummary}` | Ringkasan booking (layanan, waktu) | Cuci Premium · 10 Agustus 2026 14:00 | Ya |

**Isi pesan (bawaan):**

```text
Maaf, booking Anda belum dapat kami konfirmasi 🙏
{bookingSummary}
Silakan hubungi kami atau coba pilih waktu lain ya.
```

**Contoh hasil yang diterima:**

```text
Maaf, booking Anda belum dapat kami konfirmasi 🙏
Cuci Premium · 10 Agustus 2026 14:00
Silakan hubungi kami atau coba pilih waktu lain ya.
```

> ℹ️ Teks bisa diubah, tetapi notifikasi ini tidak bisa dimatikan karena dibutuhkan oleh alur transaksi.

### Booking kedaluwarsa otomatis

**Penerima:** Pelanggan

**Trigger:** Saat permintaan booking tidak dikonfirmasi tim sampai batas waktunya, sistem membatalkannya otomatis dan mengabari pelanggan.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{bookingSummary}` | Ringkasan booking (layanan, waktu) | Cuci Premium · 10 Agustus 2026 14:00 | Ya |

**Isi pesan (bawaan):**

```text
Halo kak, maaf banget ya 🙏 Booking kakak ({bookingSummary}) belum sempat tim kami konfirmasi jadi otomatis kedaluwarsa.
Kalau masih mau dijadwalkan, chat kami aja ya — nanti kami bantu atur ulang 😊
```

**Contoh hasil yang diterima:**

```text
Halo kak, maaf banget ya 🙏 Booking kakak (Cuci Premium · 10 Agustus 2026 14:00) belum sempat tim kami konfirmasi jadi otomatis kedaluwarsa.
Kalau masih mau dijadwalkan, chat kami aja ya — nanti kami bantu atur ulang 😊
```

### Permintaan booking baru (untuk tim)

**Penerima:** Kasir / Tim Cabang

**Trigger:** Saat ada permintaan booking lewat WhatsApp. Dikirim ke nomor eskalasi tim agar bisa dibalas TERIMA / TOLAK.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{ref}` | Kode referensi booking untuk dibalas | B7K2 | — |
| `{bookingSummary}` | Ringkasan booking | Cuci Premium · 10 Agustus 2026 14:00 | Ya |
| `{customerPhone}` | Nomor HP pelanggan | 628123456789 | — |

**Isi pesan (bawaan):**

```text
🆕 Booking baru menunggu persetujuan [{ref}]:
{bookingSummary}
Pelanggan: {customerPhone}

Balas TERIMA {ref} untuk konfirmasi atau TOLAK {ref} untuk menolak.
```

**Contoh hasil yang diterima:**

```text
🆕 Booking baru menunggu persetujuan [B7K2]:
Cuci Premium · 10 Agustus 2026 14:00
Pelanggan: 628123456789

Balas TERIMA B7K2 untuk konfirmasi atau TOLAK B7K2 untuk menolak.
```

> ℹ️ Teks bisa diubah, tetapi notifikasi ini tidak bisa dimatikan karena dibutuhkan oleh alur transaksi.

### Booking baru dari portal pelanggan (untuk cabang)

**Penerima:** Kasir / Tim Cabang

**Trigger:** Saat pelanggan membuat booking lewat portal/aplikasi. Dikirim ke nomor WhatsApp cabang beserta tautan konfirmasi.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{outletName}` | Nama cabang | Kencana Loka | — |
| `{customerName}` | Nama pelanggan | Budi | — |
| `{plate}` | Plat nomor kendaraan | B 1234 XYZ | Ya |
| `{serviceName}` | Layanan yang dipesan | Cuci Premium | Ya |
| `{scheduledAt}` | Waktu booking | 10 Agu 2026, 14.00 | — |
| `{confirmUrl}` | Tautan konfirmasi / tolak | https://app.useairin.id/confirm-booking/abc123 | — |

**Isi pesan (bawaan):**

```text
📅 *Booking baru* — {outletName}
{customerName}
Plat: {plate}
Layanan: {serviceName}
Waktu: {scheduledAt}

Konfirmasi / tolak: {confirmUrl}
```

**Contoh hasil yang diterima:**

```text
📅 *Booking baru* — Kencana Loka
Budi
Plat: B 1234 XYZ
Layanan: Cuci Premium
Waktu: 10 Agu 2026, 14.00

Konfirmasi / tolak: https://app.useairin.id/confirm-booking/abc123
```

> ℹ️ Teks bisa diubah, tetapi notifikasi ini tidak bisa dimatikan karena dibutuhkan oleh alur transaksi.

## Feedback & Ulasan

### Permintaan ulasan / feedback

**Penerima:** Pelanggan

**Trigger:** Setelah transaksi selesai, sesuai jeda waktu yang diatur di halaman Feedback (langsung atau tertunda beberapa menit).

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{thanksMessage}` | Kalimat pembuka dari pengaturan Feedback | Terima kasih sudah mampir! Bagaimana layanan kami? | — |
| `{feedbackUrl}` | Tautan formulir ulasan | https://app.useairin.id/feedback/abc123 | — |

**Isi pesan (bawaan):**

```text
{thanksMessage}
{feedbackUrl}
```

**Contoh hasil yang diterima:**

```text
Terima kasih sudah mampir! Bagaimana layanan kami?
https://app.useairin.id/feedback/abc123
```

## Akun Pelanggan

### Kode masuk akun pelanggan (OTP)

**Penerima:** Pelanggan

**Trigger:** Saat pelanggan meminta kode masuk ke portal/aplikasi pelanggan. Berlaku 5 menit.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{code}` | Kode OTP 6 digit | 482915 | — |

**Isi pesan (bawaan):**

```text
Kode masuk akun Anda: *{code}*
Berlaku 5 menit. Jangan bagikan kode ini kepada siapa pun.
```

**Contoh hasil yang diterima:**

```text
Kode masuk akun Anda: *482915*
Berlaku 5 menit. Jangan bagikan kode ini kepada siapa pun.
```

> 🔒 **Teks terkunci.** Pesan ini membawa kode keamanan. Mengubahnya berisiko membuat pelanggan gagal masuk, jadi teksnya dikunci.

### Nomor WhatsApp berhasil dikenali

**Penerima:** Pelanggan

**Trigger:** Saat pelanggan yang chat lewat WhatsApp berhasil dicocokkan dengan datanya di sistem, sehingga asisten bisa mengecek membership/voucher miliknya.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |

**Isi pesan (bawaan):**

```text
Makasih kak {customerName}! 😊 Sekarang kami sudah bisa bantu cek membership, voucher, atau booking kakak. Ada yang bisa dibantu?
```

**Contoh hasil yang diterima:**

```text
Makasih kak Budi! 😊 Sekarang kami sudah bisa bantu cek membership, voucher, atau booking kakak. Ada yang bisa dibantu?
```

## Keamanan & Persetujuan

### Percakapan diteruskan ke tim (balasan ke pelanggan)

**Penerima:** Pelanggan

**Trigger:** Saat asisten WhatsApp menyerahkan percakapan ke tim manusia.

**Isi pesan (bawaan):**

```text
Baik kak, ini kami teruskan dulu ke tim biar dibantu lebih lanjut ya 🙏 Mohon tunggu sebentar, nanti tim langsung menghubungi kakak. Sambil menunggu, ada lagi yang bisa dibantu? 😊
```

**Contoh hasil yang diterima:**

```text
Baik kak, ini kami teruskan dulu ke tim biar dibantu lebih lanjut ya 🙏 Mohon tunggu sebentar, nanti tim langsung menghubungi kakak. Sambil menunggu, ada lagi yang bisa dibantu? 😊
```

> ℹ️ Teks bisa diubah, tetapi notifikasi ini tidak bisa dimatikan karena dibutuhkan oleh alur transaksi.

### Peringatan eskalasi (untuk tim)

**Penerima:** Kasir / Tim Cabang

**Trigger:** Bersamaan dengan pesan di atas, dikirim ke nomor eskalasi tim yang diatur di pengaturan asisten.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{from}` | Nomor HP pelanggan | 628123456789 | Ya |
| `{reason}` | Alasan eskalasi | Pelanggan minta bicara dengan staf | Ya |

**Isi pesan (bawaan):**

```text
🚨 *Percakapan dieskalasi ke tim*
Dari: {from}
Alasan: {reason}
Silakan balas customer ini langsung ya.
```

**Contoh hasil yang diterima:**

```text
🚨 *Percakapan dieskalasi ke tim*
Dari: 628123456789
Alasan: Pelanggan minta bicara dengan staf
Silakan balas customer ini langsung ya.
```

> ℹ️ Teks bisa diubah, tetapi notifikasi ini tidak bisa dimatikan karena dibutuhkan oleh alur transaksi.

### Kode PIN refund

**Penerima:** Pemilik

**Trigger:** Saat kasir mengajukan refund. Kode dikirim ke nomor eskalasi tenant agar refund hanya bisa disetujui pemilik.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{orderNumber}` | Nomor pesanan | ORD-1042 | — |
| `{pin}` | Kode PIN sekali pakai | 482915 | — |
| `{ttlMinutes}` | Masa berlaku kode (menit) | 10 | — |

**Isi pesan (bawaan):**

```text
Kode PIN refund untuk order {orderNumber}: {pin}

Berlaku {ttlMinutes} menit. Jangan bagikan kode ini kepada siapa pun.
```

**Contoh hasil yang diterima:**

```text
Kode PIN refund untuk order ORD-1042: 482915

Berlaku 10 menit. Jangan bagikan kode ini kepada siapa pun.
```

> 🔒 **Teks terkunci.** Pesan ini membawa kode persetujuan refund. Teksnya dikunci demi keamanan.

### Kode PIN pembatalan transaksi (void)

**Penerima:** Pemilik

**Trigger:** Saat kasir mengajukan pembatalan transaksi. Kode dikirim ke nomor WhatsApp pemilik.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{context}` | Rincian transaksi yang akan dibatalkan | ORD-1042 · Rp150.000 · Kasir Andi | — |
| `{pin}` | Kode PIN sekali pakai | 482915 | — |
| `{ttlMinutes}` | Masa berlaku kode (menit) | 10 | — |

**Isi pesan (bawaan):**

```text
Permintaan VOID (refund) perlu persetujuan Anda.

{context}

Kode PIN: {pin}
Berlaku {ttlMinutes} menit. Berikan kode ini hanya jika Anda menyetujui pembatalan di atas.
```

**Contoh hasil yang diterima:**

```text
Permintaan VOID (refund) perlu persetujuan Anda.

ORD-1042 · Rp150.000 · Kasir Andi

Kode PIN: 482915
Berlaku 10 menit. Berikan kode ini hanya jika Anda menyetujui pembatalan di atas.
```

> 🔒 **Teks terkunci.** Pesan ini membawa kode persetujuan pembatalan. Teksnya dikunci demi keamanan.

### Usulan tindakan AI menunggu persetujuan

**Penerima:** Pemilik

**Trigger:** Saat asisten AI mengusulkan sebuah tindakan yang butuh persetujuan pemilik.

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{actionType}` | Jenis tindakan yang diusulkan | Kirim promo ke pelanggan lama | Ya |
| `{reasoning}` | Alasan AI | Ada 42 pelanggan tidak kembali selama 60 hari | Ya |
| `{confidence}` | Tingkat keyakinan AI | 78% | Ya |

**Isi pesan (bawaan):**

```text
🤖 *Usulan tindakan menunggu persetujuan*
Tindakan: {actionType}
Alasan: {reasoning}
Keyakinan: {confidence}
Buka dashboard untuk menyetujui atau menolak.
```

**Contoh hasil yang diterima:**

```text
🤖 *Usulan tindakan menunggu persetujuan*
Tindakan: Kirim promo ke pelanggan lama
Alasan: Ada 42 pelanggan tidak kembali selama 60 hari
Keyakinan: 78%
Buka dashboard untuk menyetujui atau menolak.
```

## Promo & Marketing

### Pesan campaign / promo dari AI

**Penerima:** Pelanggan

**Trigger:** Saat asisten AI menjalankan campaign ke segmen pelanggan tertentu (fitur ini harus diaktifkan dulu di pengaturan otomatisasi).

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{campaignName}` | Nama campaign | Promo Akhir Pekan | — |
| `{codes}` | Kode voucher bila ada | AIRE-PROMO1 | Ya |
| `{expiryDate}` | Tanggal kedaluwarsa bila ada | 31 Agustus 2026 | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! 🎉
Ada promo spesial buat kakak: *{campaignName}*!
Kode voucher kakak: {codes}
Berlaku sampai {expiryDate}.
Kalau mau tanya-tanya dulu, balas aja pesan ini ya kak 😊
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! 🎉
Ada promo spesial buat kakak: *Promo Akhir Pekan*!
Kode voucher kakak: AIRE-PROMO1
Berlaku sampai 31 Agustus 2026.
Kalau mau tanya-tanya dulu, balas aja pesan ini ya kak 😊
```

### Penawaran untuk pelanggan lama (retensi)

**Penerima:** Pelanggan

**Trigger:** Saat asisten AI mendeteksi pelanggan sudah lama tidak datang dan mengirim penawaran (butuh toggle "retention offers" aktif).

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{offer}` | Isi penawaran | diskon 20% untuk cuci berikutnya | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! 😊
Sudah lama nih kakak nggak mampir — kami kangen mobil kakak!
Ada penawaran khusus buat kakak: {offer}
Mau kami bantu jadwalkan cuci berikutnya?
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! 😊
Sudah lama nih kakak nggak mampir — kami kangen mobil kakak!
Ada penawaran khusus buat kakak: diskon 20% untuk cuci berikutnya
Mau kami bantu jadwalkan cuci berikutnya?
```

### Rekomendasi membership dari AI

**Penerima:** Pelanggan

**Trigger:** Saat asisten AI melihat pola cuci pelanggan lebih hemat bila memakai membership (butuh toggle "membership recommendations" aktif).

**Variabel yang tersedia:**

| Variabel | Isi | Contoh | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | — |
| `{offer}` | Isi rekomendasi | Paket Unlimited hemat ±Rp200.000/bulan | Ya |

**Isi pesan (bawaan):**

```text
Halo kak {customerName}! 😊
Dari pola cuci kakak, ada paket membership yang kelihatannya lebih hemat nih.
{offer}
Mau kami jelaskan detailnya kak?
```

**Contoh hasil yang diterima:**

```text
Halo kak Budi! 😊
Dari pola cuci kakak, ada paket membership yang kelihatannya lebih hemat nih.
Paket Unlimited hemat ±Rp200.000/bulan
Mau kami jelaskan detailnya kak?
```

## Yang tidak termasuk daftar ini

- **Broadcast / campaign manual** — isinya Anda tulis sendiri setiap kali mengirim, di menu Broadcast (mendukung variabel `{name}`).
- **Balasan asisten WhatsApp (Irene)** — dibuat oleh AI mengikuti percakapan, bukan template tetap. Gaya bicaranya diatur di pengaturan asisten, bukan di sini.
- **Notifikasi di dalam dashboard** (badge, papan antrian realtime) — tampil di layar, tidak dikirim ke WhatsApp.
