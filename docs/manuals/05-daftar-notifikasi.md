# Daftar Notifikasi Otomatis

**Dokumen referensi untuk Pemilik Usaha (Tenant Owner)**

Dokumen ini memuat seluruh pesan otomatis yang dikirimkan sistem atas nama usaha Anda. Untuk setiap pesan dicantumkan pemicunya (kondisi yang menyebabkan pesan dikirim), penerimanya, variabel yang tersedia, teks bawaan, serta contoh hasil yang diterima penerima.

Seluruh teks dalam dokumen ini dapat diubah sendiri oleh Pemilik Usaha melalui menu **Pengaturan → Notifications** pada dashboard, tanpa memerlukan bantuan tim teknis dan tanpa pembaruan sistem. Perubahan yang disimpan berlaku pada pengiriman pesan berikutnya. Panduan penggunaan halaman tersebut terdapat pada [Panduan Pemilik Usaha §11.2](02-tenant-owner-manual.md#112-notifications-settings--notifications).

> **Catatan.** Dokumen ini dihasilkan otomatis dari konfigurasi sistem. Isinya karena itu selalu identik dengan pesan yang benar-benar dikirimkan.

---

## 1. Prasyarat pengiriman

Seluruh pesan dalam dokumen ini dikirim melalui **WhatsApp**, menggunakan nomor WhatsApp yang terhubung pada cabang terkait. Ketentuan berikut berlaku untuk semua pesan:

1. **Nomor WhatsApp harus terhubung.** Apabila sambungan WhatsApp cabang terputus, pesan tidak terkirim. Status sambungan dapat diperiksa pada **Pengaturan → WhatsApp**.
2. **Nomor penerima harus tercatat.** Pesan kepada pelanggan hanya dikirim bila nomor telepon pelanggan tersimpan pada data pelanggan atau pada transaksi yang bersangkutan.
3. **Notifikasi yang dinonaktifkan tidak dikirim.** Mematikan sebuah notifikasi pada halaman **Pengaturan → Notifications** menghentikan pengirimannya sampai diaktifkan kembali.
4. **Kegagalan pengiriman tidak menghentikan transaksi.** Apabila sebuah pesan gagal terkirim, kegagalan tersebut dicatat pada log sistem dan proses penjualan, pembayaran, maupun antrian tetap berjalan normal.

---

## 2. Ketentuan penggunaan variabel

Kata yang ditulis di dalam kurung kurawal, misalnya `{customerName}`, merupakan **variabel**: sistem menggantinya dengan data sebenarnya pada saat pesan dikirim.

Ketentuan yang berlaku:

1. **Penggantian nilai.** `Halo kak {customerName}!` akan terkirim sebagai `Halo kak Budi!`.
2. **Variabel opsional.** Variabel yang ditandai *opsional* dapat bernilai kosong, misalnya voucher tanpa tanggal kedaluwarsa. Apabila nilainya kosong, **seluruh baris yang memuat variabel tersebut tidak ikut dikirim**. Ketentuan ini mencegah penerima menerima kalimat tidak lengkap seperti "Berlaku sampai .".
3. **Pembatasan variabel.** Hanya variabel yang terdaftar pada masing-masing notifikasi yang boleh digunakan. Variabel di luar daftar akan ditolak pada saat penyimpanan.
4. **Pesan terkunci.** Sebagian pesan memuat kode keamanan sekali pakai dan teksnya tidak dapat diubah. Pesan tersebut ditandai 🔒 pada tabel ringkasan.

---

## 3. Ringkasan seluruh notifikasi

Sistem mengirimkan 26 jenis pesan otomatis.

| No. | Notifikasi | Penerima | Pemicu (ringkas) | Dapat dimatikan |
|---|---|---|---|---|
| 1 | Membership aktif (selamat datang) | Pelanggan | Saat pembayaran membership berhasil dan membership pelanggan aktif. | Ya |
| 2 | Pengingat membership akan habis (H-30 / H-7 / hari-H) | Pelanggan | Otomatis setiap 6 jam, sistem mencari membership aktif yang berakhir tepat dalam 30 hari, 7 hari, atau hari ini, lalu mengirim pengingat. | Ya |
| 3 | Voucher dibeli — kode dikirim | Pelanggan | Saat pelanggan membeli paket voucher di kasir dan nomor HP-nya tercatat. | Ya |
| 4 | Voucher bonus diberikan | Pelanggan | Saat pelanggan mendapat voucher bonus dari sebuah campaign/promo (bukan pembelian). | Ya |
| 5 | Voucher terpakai — sisa saldo | Pelanggan | Saat satu atau lebih kode voucher ditukarkan di kasir, dan masih ada sisa kode. | Ya |
| 6 | Voucher terpakai — dipakai orang lain | Pelanggan | Ketika kode voucher ditukarkan oleh orang yang bukan pemilik voucher (voucher memang bisa dibagikan). | Ya |
| 7 | Voucher terpakai — kode habis | Pelanggan | Sama seperti di atas, tetapi dikirim ketika kode voucher pelanggan sudah habis semua. | Ya |
| 8 | Struk / invoice (dikirim kasir dari layar struk) | Pelanggan | Dikirim atas permintaan kasir melalui tombol kirim struk pada layar struk, setelah pesanan lunas dan nomor HP pelanggan tercatat. | Ya |
| 9 | Mobil selesai dicuci | Pelanggan | Saat kasir menandai mobil pada papan antrian sebagai "selesai" dan nomor HP pelanggan tercatat. | Ya |
| 10 | Permintaan booking diterima | Pelanggan | Saat pelanggan mengajukan booking lewat WhatsApp dan permintaannya menunggu konfirmasi tim. | Tidak |
| 11 | Booking dikonfirmasi | Pelanggan | Saat tim cabang menyetujui booking — baik lewat balasan WhatsApp maupun lewat tautan konfirmasi dari portal pelanggan. | Tidak |
| 12 | Booking ditolak | Pelanggan | Saat tim cabang menolak permintaan booking pelanggan. | Tidak |
| 13 | Booking kedaluwarsa otomatis | Pelanggan | Saat permintaan booking tidak dikonfirmasi tim sampai batas waktunya, sistem membatalkannya otomatis dan mengabari pelanggan. | Ya |
| 14 | Permintaan booking baru (untuk tim) | Kasir / Tim Cabang | Saat ada permintaan booking lewat WhatsApp. | Tidak |
| 15 | Booking baru dari portal pelanggan (untuk cabang) | Kasir / Tim Cabang | Saat pelanggan membuat booking lewat portal/aplikasi. | Tidak |
| 16 | Permintaan ulasan / feedback | Pelanggan | Setelah pesanan lunas, apabila fitur Feedback diaktifkan dan diatur untuk mengirim otomatis pada halaman Feedback & NPS. | Ya |
| 17 | Kode masuk akun pelanggan (OTP) | Pelanggan | Saat pelanggan meminta kode masuk ke portal/aplikasi pelanggan. | 🔒 Tidak (terkunci) |
| 18 | Nomor WhatsApp berhasil dikenali | Pelanggan | Saat pelanggan yang chat lewat WhatsApp berhasil dicocokkan dengan datanya di sistem, sehingga asisten bisa mengecek membership/voucher miliknya. | Ya |
| 19 | Percakapan diteruskan ke tim (balasan ke pelanggan) | Pelanggan | Saat asisten WhatsApp menyerahkan percakapan ke tim manusia. | Tidak |
| 20 | Peringatan eskalasi (untuk tim) | Kasir / Tim Cabang | Bersamaan dengan pesan di atas, dikirim ke nomor eskalasi tim yang diatur di pengaturan asisten. | Tidak |
| 21 | Kode PIN refund | Pemilik | Saat kasir mengajukan refund. | 🔒 Tidak (terkunci) |
| 22 | Kode PIN pembatalan transaksi (void) | Pemilik | Saat kasir mengajukan pembatalan transaksi (void). | 🔒 Tidak (terkunci) |
| 23 | Usulan tindakan AI menunggu persetujuan | Pemilik | Saat asisten AI mengusulkan sebuah tindakan yang butuh persetujuan pemilik. | Ya |
| 24 | Pesan campaign / promo dari AI | Pelanggan | Saat asisten AI menjalankan campaign ke segmen pelanggan tertentu (fitur ini harus diaktifkan dulu di pengaturan otomatisasi). | Ya |
| 25 | Penawaran untuk pelanggan lama (retensi) | Pelanggan | Saat asisten AI mendeteksi pelanggan sudah lama tidak datang dan mengirim penawaran (butuh toggle "retention offers" aktif). | Ya |
| 26 | Rekomendasi membership dari AI | Pelanggan | Saat asisten AI melihat pola cuci pelanggan lebih hemat bila memakai membership (butuh toggle "membership recommendations" aktif). | Ya |

---

## 4. Rincian per notifikasi

### 4.1 Membership

#### 4.1.1 Membership aktif (selamat datang)

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `membership_welcome` |

**Pemicu.** Saat pembayaran membership berhasil dan membership pelanggan aktif. Hanya dikirim bila paket membership tersebut mengaktifkan "kirim pesan selamat datang". Dikirim satu kali per membership.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{planName}` | Nama paket membership | Unlimited | Tidak |
| `{endDate}` | Tanggal berakhir membership | 06 September 2026 | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! 🎉
Selamat, membership *{planName}* kakak sudah aktif!
Berlaku sampai {endDate}.
Tinggal sebutkan nomor HP atau plat mobil kakak di kasir untuk pakai benefitnya ya 😊
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! 🎉
Selamat, membership *Unlimited* kakak sudah aktif!
Berlaku sampai 06 September 2026.
Tinggal sebutkan nomor HP atau plat mobil kakak di kasir untuk pakai benefitnya ya 😊
```

#### 4.1.2 Pengingat membership akan habis (H-30 / H-7 / hari-H)

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `membership_expiry_reminder` |

**Pemicu.** Otomatis setiap 6 jam, sistem mencari membership aktif yang berakhir tepat dalam 30 hari, 7 hari, atau hari ini, lalu mengirim pengingat. Setiap tahap dikirim satu kali untuk setiap periode membership; bila membership diperpanjang, ketiga tahap berlaku kembali untuk periode yang baru. Pelanggan yang tanggal berakhirnya sudah melewati salah satu tahap tidak menerima pengingat tahap tersebut.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{planName}` | Nama paket membership | Unlimited | Tidak |
| `{expiryPhrase}` | Keterangan waktu otomatis: "hari ini" atau "7 hari lagi" | 7 hari lagi | Tidak |
| `{endDate}` | Tanggal berakhir membership | 06 September 2026 | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! 🔔
Membership *{planName}* kakak habis *{expiryPhrase}*.
Berlaku sampai {endDate}.
Mau kami bantu perpanjang sekarang biar benefitnya jalan terus? 😊
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! 🔔
Membership *Unlimited* kakak habis *7 hari lagi*.
Berlaku sampai 06 September 2026.
Mau kami bantu perpanjang sekarang biar benefitnya jalan terus? 😊
```

### 4.2 Voucher

#### 4.2.1 Voucher dibeli — kode dikirim

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `voucher_purchased` |

**Pemicu.** Saat pelanggan membeli paket voucher di kasir dan nomor HP-nya tercatat. Berisi seluruh kode voucher yang baru terbit.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pembeli | Budi | Tidak |
| `{voucherName}` | Nama paket voucher | Paket Cuci 10x | Tidak |
| `{codeCount}` | Jumlah kode voucher | 10 | Tidak |
| `{codeList}` | Daftar kode voucher (otomatis, satu per baris) | 1. AIRE-8F2K / 2. AIRE-9Q1M | Ya |
| `{expiryDate}` | Tanggal kedaluwarsa voucher (kosong bila tanpa batas) | 31 Desember 2026 | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! Terima kasih atas pembelian *{voucherName}* 🎫

Berikut {codeCount} kode voucher yang bisa kakak gunakan:
{codeList}
Berlaku sampai {expiryDate}.
Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! Terima kasih atas pembelian *Paket Cuci 10x* 🎫

Berikut 10 kode voucher yang bisa kakak gunakan:
1. AIRE-8F2K
2. AIRE-9Q1M
Berlaku sampai 31 Desember 2026.
Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊
```

#### 4.2.2 Voucher bonus diberikan

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `voucher_bonus_granted` |

**Pemicu.** Saat pelanggan mendapat voucher bonus dari sebuah campaign/promo (bukan pembelian). Berisi kode voucher bonusnya.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{voucherName}` | Nama paket voucher bonus | Bonus Cuci Gratis | Tidak |
| `{codeCount}` | Jumlah kode voucher | 2 | Tidak |
| `{codeList}` | Daftar kode voucher (otomatis, satu per baris) | 1. AIRE-BON1 / 2. AIRE-BON2 | Ya |
| `{expiryDate}` | Tanggal kedaluwarsa voucher (kosong bila tanpa batas) | 31 Desember 2026 | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! 🎉 Selamat, kakak dapat bonus *{voucherName}*!

Berikut {codeCount} kode voucher yang bisa kakak gunakan:
{codeList}
Berlaku sampai {expiryDate}.
Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! 🎉 Selamat, kakak dapat bonus *Bonus Cuci Gratis*!

Berikut 2 kode voucher yang bisa kakak gunakan:
1. AIRE-BON1
2. AIRE-BON2
Berlaku sampai 31 Desember 2026.
Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊
```

#### 4.2.3 Voucher terpakai — sisa saldo

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `voucher_used` |

**Pemicu.** Saat satu atau lebih kode voucher ditukarkan di kasir, dan masih ada sisa kode. Dikirim ke pemilik voucher.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{voucherName}` | Nama paket voucher | Paket Cuci 10x | Tidak |
| `{usedDetail}` | Rincian pemakaian otomatis, mis. " (2 kode) di transaksi ORD-1042, hemat Rp100.000" |  di transaksi ORD-1042, hemat Rp50.000 | Ya |
| `{remainingCount}` | Sisa kode voucher | 8 | Tidak |
| `{remainingCodes}` | Daftar sisa kode (hanya untuk pemilik voucher) | 1. AIRE-8F2K / 2. AIRE-9Q1M | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! 😊 Voucher *{voucherName}* berhasil digunakan{usedDetail}.

Sisa voucher kakak: *{remainingCount}* kode
{remainingCodes}

Terima kasih ya kak! 🚗✨
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! 😊 Voucher *Paket Cuci 10x* berhasil digunakan di transaksi ORD-1042, hemat Rp50.000.

Sisa voucher kakak: *8* kode
1. AIRE-8F2K
2. AIRE-9Q1M

Terima kasih ya kak! 🚗✨
```

#### 4.2.4 Voucher terpakai — dipakai orang lain

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `voucher_used_shared` |

**Pemicu.** Ketika kode voucher ditukarkan oleh orang yang bukan pemilik voucher (voucher memang bisa dibagikan). Penerima hanya diberi tahu jumlah sisanya — daftar kodenya tidak ikut dikirim karena itu milik orang lain.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{voucherName}` | Nama paket voucher | Paket Cuci 10x | Tidak |
| `{usedDetail}` | Rincian pemakaian otomatis |  di transaksi ORD-1042, hemat Rp50.000 | Ya |
| `{remainingCount}` | Sisa kode voucher | 8 | Tidak |

**Teks bawaan.**

```text
Halo kak! 😊 Voucher *{voucherName}* berhasil digunakan{usedDetail}.

Sisa voucher: *{remainingCount}* kode.

Terima kasih ya kak! 🚗✨
```

**Contoh hasil yang diterima.**

```text
Halo kak! 😊 Voucher *Paket Cuci 10x* berhasil digunakan di transaksi ORD-1042, hemat Rp50.000.

Sisa voucher: *8* kode.

Terima kasih ya kak! 🚗✨
```

#### 4.2.5 Voucher terpakai — kode habis

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `voucher_used_last` |

**Pemicu.** Sama seperti di atas, tetapi dikirim ketika kode voucher pelanggan sudah habis semua.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{voucherName}` | Nama paket voucher | Paket Cuci 10x | Tidak |
| `{usedDetail}` | Rincian pemakaian otomatis |  di transaksi ORD-1042, hemat Rp50.000 | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! 😊 Voucher *{voucherName}* berhasil digunakan{usedDetail}.

Voucher kakak sudah terpakai semua ya 🙏 Kalau mau beli lagi, tinggal bilang ke kami aja kak!

Terima kasih ya kak! 🚗✨
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! 😊 Voucher *Paket Cuci 10x* berhasil digunakan di transaksi ORD-1042, hemat Rp50.000.

Voucher kakak sudah terpakai semua ya 🙏 Kalau mau beli lagi, tinggal bilang ke kami aja kak!

Terima kasih ya kak! 🚗✨
```

### 4.3 Transaksi & Pembayaran

#### 4.3.1 Struk / invoice (dikirim kasir dari layar struk)

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `payment_receipt` |

**Pemicu.** Dikirim atas permintaan kasir melalui tombol kirim struk pada layar struk, setelah pesanan lunas dan nomor HP pelanggan tercatat. Pengiriman TIDAK otomatis pada setiap transaksi: kasir memutuskan per penjualan, karena setiap pesan WhatsApp dikenakan biaya. Berisi tautan struk digital yang dapat dibuka pelanggan, dan boleh dikirim ulang bila nomor tujuan salah.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{orderNumber}` | Nomor pesanan | ORD-1042 | Tidak |
| `{total}` | Total pembayaran | Rp150.000 | Tidak |
| `{receiptUrl}` | Tautan struk digital | https://app.useairin.id/receipt/abc123 | Tidak |

**Teks bawaan.**

```text
Halo {customerName}, terima kasih atas pembayaran Anda 🙏
Pesanan {orderNumber} — Total {total}.
Lihat invoice: {receiptUrl}
```

**Contoh hasil yang diterima.**

```text
Halo Budi, terima kasih atas pembayaran Anda 🙏
Pesanan ORD-1042 — Total Rp150.000.
Lihat invoice: https://app.useairin.id/receipt/abc123
```

### 4.4 Antrian

#### 4.4.1 Mobil selesai dicuci

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `queue_completion` |

**Pemicu.** Saat kasir menandai mobil pada papan antrian sebagai "selesai" dan nomor HP pelanggan tercatat. Mobil hanya dapat ditandai selesai setelah pesanannya lunas, sehingga pesan ini selalu dikirim setelah pembayaran.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{plate}` | Plat nomor kendaraan | B 1234 XYZ | Ya |
| `{outletName}` | Nama cabang | Kencana Loka | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! ✨
Mobil kakak sudah selesai dicuci 🚗
Plat: {plate}
Cabang: {outletName}
Silakan menuju kasir ya kak. Terima kasih!
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! ✨
Mobil kakak sudah selesai dicuci 🚗
Plat: B 1234 XYZ
Cabang: Kencana Loka
Silakan menuju kasir ya kak. Terima kasih!
```

### 4.5 Booking

#### 4.5.1 Permintaan booking diterima

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Tidak |
| **Kode sistem** | `booking_received` |

**Pemicu.** Saat pelanggan mengajukan booking lewat WhatsApp dan permintaannya menunggu konfirmasi tim.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{bookingSummary}` | Ringkasan booking (layanan, waktu) | Cuci Premium · 10 Agustus 2026 14:00 | Ya |

**Teks bawaan.**

```text
Terima kasih! Permintaan booking Anda kami terima ✅
{bookingSummary}
Menunggu konfirmasi akhir dari tim kami — Anda akan kami kabari.
```

**Contoh hasil yang diterima.**

```text
Terima kasih! Permintaan booking Anda kami terima ✅
Cuci Premium · 10 Agustus 2026 14:00
Menunggu konfirmasi akhir dari tim kami — Anda akan kami kabari.
```

> **Tidak dapat dimatikan.** Teks pesan ini dapat diubah, namun pengirimannya tidak dapat dinonaktifkan karena dibutuhkan oleh alur transaksi.

#### 4.5.2 Booking dikonfirmasi

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Tidak |
| **Kode sistem** | `booking_confirmed` |

**Pemicu.** Saat tim cabang menyetujui booking — baik lewat balasan WhatsApp maupun lewat tautan konfirmasi dari portal pelanggan.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{bookingSummary}` | Ringkasan booking (layanan, waktu) | Cuci Premium · 10 Agustus 2026 14:00 | Ya |

**Teks bawaan.**

```text
Booking Anda telah DIKONFIRMASI tim kami ✅
{bookingSummary}
Sampai jumpa!
```

**Contoh hasil yang diterima.**

```text
Booking Anda telah DIKONFIRMASI tim kami ✅
Cuci Premium · 10 Agustus 2026 14:00
Sampai jumpa!
```

> **Tidak dapat dimatikan.** Teks pesan ini dapat diubah, namun pengirimannya tidak dapat dinonaktifkan karena dibutuhkan oleh alur transaksi.

#### 4.5.3 Booking ditolak

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Tidak |
| **Kode sistem** | `booking_rejected` |

**Pemicu.** Saat tim cabang menolak permintaan booking pelanggan.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{bookingSummary}` | Ringkasan booking (layanan, waktu) | Cuci Premium · 10 Agustus 2026 14:00 | Ya |

**Teks bawaan.**

```text
Maaf, booking Anda belum dapat kami konfirmasi 🙏
{bookingSummary}
Silakan hubungi kami atau coba pilih waktu lain ya.
```

**Contoh hasil yang diterima.**

```text
Maaf, booking Anda belum dapat kami konfirmasi 🙏
Cuci Premium · 10 Agustus 2026 14:00
Silakan hubungi kami atau coba pilih waktu lain ya.
```

> **Tidak dapat dimatikan.** Teks pesan ini dapat diubah, namun pengirimannya tidak dapat dinonaktifkan karena dibutuhkan oleh alur transaksi.

#### 4.5.4 Booking kedaluwarsa otomatis

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `booking_expired` |

**Pemicu.** Saat permintaan booking tidak dikonfirmasi tim sampai batas waktunya, sistem membatalkannya otomatis dan mengabari pelanggan.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{bookingSummary}` | Ringkasan booking (layanan, waktu) | Cuci Premium · 10 Agustus 2026 14:00 | Ya |

**Teks bawaan.**

```text
Halo kak, maaf banget ya 🙏 Booking kakak ({bookingSummary}) belum sempat tim kami konfirmasi jadi otomatis kedaluwarsa.
Kalau masih mau dijadwalkan, chat kami aja ya — nanti kami bantu atur ulang 😊
```

**Contoh hasil yang diterima.**

```text
Halo kak, maaf banget ya 🙏 Booking kakak (Cuci Premium · 10 Agustus 2026 14:00) belum sempat tim kami konfirmasi jadi otomatis kedaluwarsa.
Kalau masih mau dijadwalkan, chat kami aja ya — nanti kami bantu atur ulang 😊
```

#### 4.5.5 Permintaan booking baru (untuk tim)

| | |
|---|---|
| **Penerima** | Kasir / Tim Cabang |
| **Dapat dimatikan** | Tidak |
| **Kode sistem** | `booking_approval_request` |

**Pemicu.** Saat ada permintaan booking lewat WhatsApp. Dikirim ke nomor eskalasi tim agar bisa dibalas TERIMA / TOLAK.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{ref}` | Kode referensi booking untuk dibalas | B7K2 | Tidak |
| `{bookingSummary}` | Ringkasan booking | Cuci Premium · 10 Agustus 2026 14:00 | Ya |
| `{customerPhone}` | Nomor HP pelanggan | 628123456789 | Tidak |

**Teks bawaan.**

```text
🆕 Booking baru menunggu persetujuan [{ref}]:
{bookingSummary}
Pelanggan: {customerPhone}

Balas TERIMA {ref} untuk konfirmasi atau TOLAK {ref} untuk menolak.
```

**Contoh hasil yang diterima.**

```text
🆕 Booking baru menunggu persetujuan [B7K2]:
Cuci Premium · 10 Agustus 2026 14:00
Pelanggan: 628123456789

Balas TERIMA B7K2 untuk konfirmasi atau TOLAK B7K2 untuk menolak.
```

> **Tidak dapat dimatikan.** Teks pesan ini dapat diubah, namun pengirimannya tidak dapat dinonaktifkan karena dibutuhkan oleh alur transaksi.

#### 4.5.6 Booking baru dari portal pelanggan (untuk cabang)

| | |
|---|---|
| **Penerima** | Kasir / Tim Cabang |
| **Dapat dimatikan** | Tidak |
| **Kode sistem** | `booking_branch_alert` |

**Pemicu.** Saat pelanggan membuat booking lewat portal/aplikasi. Dikirim ke nomor WhatsApp cabang beserta tautan konfirmasi.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{outletName}` | Nama cabang | Kencana Loka | Tidak |
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{plate}` | Plat nomor kendaraan | B 1234 XYZ | Ya |
| `{serviceName}` | Layanan yang dipesan | Cuci Premium | Ya |
| `{scheduledAt}` | Waktu booking | 10 Agu 2026, 14.00 | Tidak |
| `{confirmUrl}` | Tautan konfirmasi / tolak | https://app.useairin.id/confirm-booking/abc123 | Tidak |

**Teks bawaan.**

```text
📅 *Booking baru* — {outletName}
{customerName}
Plat: {plate}
Layanan: {serviceName}
Waktu: {scheduledAt}

Konfirmasi / tolak: {confirmUrl}
```

**Contoh hasil yang diterima.**

```text
📅 *Booking baru* — Kencana Loka
Budi
Plat: B 1234 XYZ
Layanan: Cuci Premium
Waktu: 10 Agu 2026, 14.00

Konfirmasi / tolak: https://app.useairin.id/confirm-booking/abc123
```

> **Tidak dapat dimatikan.** Teks pesan ini dapat diubah, namun pengirimannya tidak dapat dinonaktifkan karena dibutuhkan oleh alur transaksi.

### 4.6 Feedback & Ulasan

#### 4.6.1 Permintaan ulasan / feedback

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `feedback_request` |

**Pemicu.** Setelah pesanan lunas, apabila fitur Feedback diaktifkan dan diatur untuk mengirim otomatis pada halaman Feedback & NPS. Dikirim langsung atau tertunda sesuai jeda waktu yang diatur di halaman tersebut.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{thanksMessage}` | Kalimat pembuka dari pengaturan Feedback | Terima kasih sudah mampir! Bagaimana layanan kami? | Tidak |
| `{feedbackUrl}` | Tautan formulir ulasan | https://app.useairin.id/feedback/abc123 | Tidak |

**Teks bawaan.**

```text
{thanksMessage}
{feedbackUrl}
```

**Contoh hasil yang diterima.**

```text
Terima kasih sudah mampir! Bagaimana layanan kami?
https://app.useairin.id/feedback/abc123
```

### 4.7 Akun Pelanggan

#### 4.7.1 Kode masuk akun pelanggan (OTP)

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Tidak (terkunci) |
| **Kode sistem** | `portal_login_otp` |

**Pemicu.** Saat pelanggan meminta kode masuk ke portal/aplikasi pelanggan. Berlaku 5 menit.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{code}` | Kode OTP 6 digit | 482915 | Tidak |

**Teks bawaan.**

```text
Kode masuk akun Anda: *{code}*
Berlaku 5 menit. Jangan bagikan kode ini kepada siapa pun.
```

**Contoh hasil yang diterima.**

```text
Kode masuk akun Anda: *482915*
Berlaku 5 menit. Jangan bagikan kode ini kepada siapa pun.
```

> 🔒 **Teks terkunci.** Pesan ini membawa kode keamanan. Mengubahnya berisiko membuat pelanggan gagal masuk, jadi teksnya dikunci.

#### 4.7.2 Nomor WhatsApp berhasil dikenali

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `customer_linked_ack` |

**Pemicu.** Saat pelanggan yang chat lewat WhatsApp berhasil dicocokkan dengan datanya di sistem, sehingga asisten bisa mengecek membership/voucher miliknya.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |

**Teks bawaan.**

```text
Makasih kak {customerName}! 😊 Sekarang kami sudah bisa bantu cek membership, voucher, atau booking kakak. Ada yang bisa dibantu?
```

**Contoh hasil yang diterima.**

```text
Makasih kak Budi! 😊 Sekarang kami sudah bisa bantu cek membership, voucher, atau booking kakak. Ada yang bisa dibantu?
```

### 4.8 Keamanan & Persetujuan

#### 4.8.1 Percakapan diteruskan ke tim (balasan ke pelanggan)

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Tidak |
| **Kode sistem** | `escalation_ack` |

**Pemicu.** Saat asisten WhatsApp menyerahkan percakapan ke tim manusia.

**Variabel yang tersedia.** Tidak ada; pesan ini tidak memuat variabel.

**Teks bawaan.**

```text
Baik kak, ini kami teruskan dulu ke tim biar dibantu lebih lanjut ya 🙏 Mohon tunggu sebentar, nanti tim langsung menghubungi kakak. Sambil menunggu, ada lagi yang bisa dibantu? 😊
```

**Contoh hasil yang diterima.**

```text
Baik kak, ini kami teruskan dulu ke tim biar dibantu lebih lanjut ya 🙏 Mohon tunggu sebentar, nanti tim langsung menghubungi kakak. Sambil menunggu, ada lagi yang bisa dibantu? 😊
```

> **Tidak dapat dimatikan.** Teks pesan ini dapat diubah, namun pengirimannya tidak dapat dinonaktifkan karena dibutuhkan oleh alur transaksi.

#### 4.8.2 Peringatan eskalasi (untuk tim)

| | |
|---|---|
| **Penerima** | Kasir / Tim Cabang |
| **Dapat dimatikan** | Tidak |
| **Kode sistem** | `escalation_alert` |

**Pemicu.** Bersamaan dengan pesan di atas, dikirim ke nomor eskalasi tim yang diatur di pengaturan asisten.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{from}` | Nomor HP pelanggan | 628123456789 | Ya |
| `{reason}` | Alasan eskalasi | Pelanggan minta bicara dengan staf | Ya |

**Teks bawaan.**

```text
🚨 *Percakapan dieskalasi ke tim*
Dari: {from}
Alasan: {reason}
Silakan balas customer ini langsung ya.
```

**Contoh hasil yang diterima.**

```text
🚨 *Percakapan dieskalasi ke tim*
Dari: 628123456789
Alasan: Pelanggan minta bicara dengan staf
Silakan balas customer ini langsung ya.
```

> **Tidak dapat dimatikan.** Teks pesan ini dapat diubah, namun pengirimannya tidak dapat dinonaktifkan karena dibutuhkan oleh alur transaksi.

#### 4.8.3 Kode PIN refund

| | |
|---|---|
| **Penerima** | Pemilik |
| **Dapat dimatikan** | Tidak (terkunci) |
| **Kode sistem** | `refund_pin` |

**Pemicu.** Saat kasir mengajukan refund. Kode dikirim ke nomor eskalasi yang diatur pada pengaturan asisten, agar refund hanya dapat disetujui pemilik. Apabila nomor eskalasi belum diatur atau pengiriman WhatsApp gagal, kode dikirim melalui surel ke pemilik. Berlaku 10 menit dan hanya kode terakhir yang diminta yang sah.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{orderNumber}` | Nomor pesanan | ORD-1042 | Tidak |
| `{pin}` | Kode PIN sekali pakai | 482915 | Tidak |
| `{ttlMinutes}` | Masa berlaku kode (menit) | 10 | Tidak |

**Teks bawaan.**

```text
Kode PIN refund untuk order {orderNumber}: {pin}

Berlaku {ttlMinutes} menit. Jangan bagikan kode ini kepada siapa pun.
```

**Contoh hasil yang diterima.**

```text
Kode PIN refund untuk order ORD-1042: 482915

Berlaku 10 menit. Jangan bagikan kode ini kepada siapa pun.
```

> 🔒 **Teks terkunci.** Pesan ini membawa kode persetujuan refund. Teksnya dikunci demi keamanan.

#### 4.8.4 Kode PIN pembatalan transaksi (void)

| | |
|---|---|
| **Penerima** | Pemilik |
| **Dapat dimatikan** | Tidak (terkunci) |
| **Kode sistem** | `void_pin` |

**Pemicu.** Saat kasir mengajukan pembatalan transaksi (void). Kode dikirim ke nomor WhatsApp pemilik, dan apabila pengiriman WhatsApp gagal, dikirim melalui surel ke pemilik. Berlaku 10 menit.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{context}` | Rincian transaksi yang akan dibatalkan | ORD-1042 · Rp150.000 · Kasir Andi | Tidak |
| `{pin}` | Kode PIN sekali pakai | 482915 | Tidak |
| `{ttlMinutes}` | Masa berlaku kode (menit) | 10 | Tidak |

**Teks bawaan.**

```text
Permintaan VOID (refund) perlu persetujuan Anda.

{context}

Kode PIN: {pin}
Berlaku {ttlMinutes} menit. Berikan kode ini hanya jika Anda menyetujui pembatalan di atas.
```

**Contoh hasil yang diterima.**

```text
Permintaan VOID (refund) perlu persetujuan Anda.

ORD-1042 · Rp150.000 · Kasir Andi

Kode PIN: 482915
Berlaku 10 menit. Berikan kode ini hanya jika Anda menyetujui pembatalan di atas.
```

> 🔒 **Teks terkunci.** Pesan ini membawa kode persetujuan pembatalan. Teksnya dikunci demi keamanan.

#### 4.8.5 Usulan tindakan AI menunggu persetujuan

| | |
|---|---|
| **Penerima** | Pemilik |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `action_proposal_pending` |

**Pemicu.** Saat asisten AI mengusulkan sebuah tindakan yang butuh persetujuan pemilik.

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{actionType}` | Jenis tindakan yang diusulkan | Kirim promo ke pelanggan lama | Ya |
| `{reasoning}` | Alasan AI | Ada 42 pelanggan tidak kembali selama 60 hari | Ya |
| `{confidence}` | Tingkat keyakinan AI | 78% | Ya |

**Teks bawaan.**

```text
🤖 *Usulan tindakan menunggu persetujuan*
Tindakan: {actionType}
Alasan: {reasoning}
Keyakinan: {confidence}
Buka dashboard untuk menyetujui atau menolak.
```

**Contoh hasil yang diterima.**

```text
🤖 *Usulan tindakan menunggu persetujuan*
Tindakan: Kirim promo ke pelanggan lama
Alasan: Ada 42 pelanggan tidak kembali selama 60 hari
Keyakinan: 78%
Buka dashboard untuk menyetujui atau menolak.
```

### 4.9 Promo & Marketing

#### 4.9.1 Pesan campaign / promo dari AI

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `campaign_bonus` |

**Pemicu.** Saat asisten AI menjalankan campaign ke segmen pelanggan tertentu (fitur ini harus diaktifkan dulu di pengaturan otomatisasi).

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{campaignName}` | Nama campaign | Promo Akhir Pekan | Tidak |
| `{codes}` | Kode voucher bila ada | AIRE-PROMO1 | Ya |
| `{expiryDate}` | Tanggal kedaluwarsa bila ada | 31 Agustus 2026 | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! 🎉
Ada promo spesial buat kakak: *{campaignName}*!
Kode voucher kakak: {codes}
Berlaku sampai {expiryDate}.
Kalau mau tanya-tanya dulu, balas aja pesan ini ya kak 😊
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! 🎉
Ada promo spesial buat kakak: *Promo Akhir Pekan*!
Kode voucher kakak: AIRE-PROMO1
Berlaku sampai 31 Agustus 2026.
Kalau mau tanya-tanya dulu, balas aja pesan ini ya kak 😊
```

#### 4.9.2 Penawaran untuk pelanggan lama (retensi)

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `retention_offer` |

**Pemicu.** Saat asisten AI mendeteksi pelanggan sudah lama tidak datang dan mengirim penawaran (butuh toggle "retention offers" aktif).

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{offer}` | Isi penawaran | diskon 20% untuk cuci berikutnya | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! 😊
Sudah lama nih kakak nggak mampir — kami kangen mobil kakak!
Ada penawaran khusus buat kakak: {offer}
Mau kami bantu jadwalkan cuci berikutnya?
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! 😊
Sudah lama nih kakak nggak mampir — kami kangen mobil kakak!
Ada penawaran khusus buat kakak: diskon 20% untuk cuci berikutnya
Mau kami bantu jadwalkan cuci berikutnya?
```

#### 4.9.3 Rekomendasi membership dari AI

| | |
|---|---|
| **Penerima** | Pelanggan |
| **Dapat dimatikan** | Ya |
| **Kode sistem** | `membership_recommendation` |

**Pemicu.** Saat asisten AI melihat pola cuci pelanggan lebih hemat bila memakai membership (butuh toggle "membership recommendations" aktif).

**Variabel yang tersedia.**

| Variabel | Keterangan | Contoh nilai | Opsional |
|---|---|---|---|
| `{customerName}` | Nama pelanggan | Budi | Tidak |
| `{offer}` | Isi rekomendasi | Paket Unlimited hemat ±Rp200.000/bulan | Ya |

**Teks bawaan.**

```text
Halo kak {customerName}! 😊
Dari pola cuci kakak, ada paket membership yang kelihatannya lebih hemat nih.
{offer}
Mau kami jelaskan detailnya kak?
```

**Contoh hasil yang diterima.**

```text
Halo kak Budi! 😊
Dari pola cuci kakak, ada paket membership yang kelihatannya lebih hemat nih.
Paket Unlimited hemat ±Rp200.000/bulan
Mau kami jelaskan detailnya kak?
```

---

## 5. Pesan yang tidak tercakup dalam dokumen ini

Tiga jenis pesan berikut tidak diatur melalui halaman **Pengaturan → Notifications** dan karena itu tidak tercantum di atas:

1. **Broadcast / campaign manual.** Teksnya disusun sendiri oleh pengguna pada setiap pengiriman melalui menu **WA Broadcast**, dengan dukungan variabel `{name}`.
2. **Balasan asisten WhatsApp.** Disusun oleh AI mengikuti jalannya percakapan, bukan berdasarkan template tetap. Gaya bahasanya diatur pada pengaturan asisten.
3. **Notifikasi di dalam dashboard.** Misalnya penanda jumlah dan papan antrian waktu nyata; ditampilkan di layar dan tidak dikirimkan melalui WhatsApp.
