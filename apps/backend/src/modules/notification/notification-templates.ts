/**
 * Plain-text bodies for the notifications that used to be sent as REGISTERED
 * TEMPLATES against the Meta WhatsApp Business Cloud API.
 *
 * That vendor was never wired on this platform — messages go out over
 * WAHA/kirimdev via WhatsappService.sendText, which takes text, not a template
 * id + ordered params. So every `sendWhatsApp` caller (membership welcome,
 * expiry reminders, agent offers, proposal alerts) silently failed for as long
 * as it has existed. Giving each template a real body is what makes them
 * deliverable.
 *
 * Bahasa Indonesia, and phrased in the same voice as the rest of the customer
 * messaging. Formatting is left plain — `formatForWhatsApp` normalises it at the
 * outbound chokepoint.
 */

export type TemplateParams = Record<string, string>;

const has = (v: string | undefined): v is string => !!v && v.trim() !== '';

/** `Halo kak Budi!` / `Halo kak!` — never `Halo kak !`. */
const greet = (name: string | undefined) => (has(name) ? `Halo kak ${name.trim()}!` : 'Halo kak!');

/**
 * Render a notification into WhatsApp-ready text. Returns null for an unknown
 * template so the caller can log it rather than send an empty bubble.
 */
export function renderNotificationText(templateName: string, params: TemplateParams): string | null {
  const p = params ?? {};

  switch (templateName) {
    case 'membership_welcome':
      return [
        `${greet(p.customerName)} 🎉`,
        `Selamat, membership *${p.planName ?? ''}* kakak sudah aktif!`,
        has(p.endDate) ? `Berlaku sampai ${p.endDate}.` : '',
        'Tinggal sebutkan nomor HP atau plat mobil kakak di kasir untuk pakai benefitnya ya 😊',
      ].filter(Boolean).join('\n');

    case 'expiry_reminder': {
      const days = Number(p.daysRemaining);
      const when = days === 0
        ? 'habis *hari ini*'
        : Number.isFinite(days) ? `habis dalam *${days} hari*` : 'segera habis';
      return [
        `${greet(p.customerName)} 🔔`,
        `Membership *${p.planName ?? ''}* kakak ${when}${has(p.endDate) ? ` (${p.endDate})` : ''}.`,
        'Mau Irene bantu perpanjang sekarang biar benefitnya jalan terus? 😊',
      ].filter(Boolean).join('\n');
    }

    case 'voucher_delivery':
      return [
        `${greet(p.customerName)} 🎫`,
        'Terima kasih! Berikut kode voucher yang bisa kakak gunakan:',
        p.codes ?? '',
        has(p.expiryDate) && p.expiryDate !== 'no expiry' ? `Berlaku sampai ${p.expiryDate}.` : '',
        'Tunjukkan kodenya ke kasir saat mau dipakai ya kak 😊',
      ].filter(Boolean).join('\n');

    case 'campaign_bonus':
      return [
        `${greet(p.customerName)} 🎉`,
        has(p.campaignName) ? `Ada promo spesial buat kakak: *${p.campaignName}*!` : 'Ada promo spesial buat kakak!',
        has(p.codes) ? `Kode voucher kakak:\n${p.codes}` : '',
        has(p.expiryDate) && p.expiryDate !== 'no expiry' ? `Berlaku sampai ${p.expiryDate}.` : '',
        'Kalau mau tanya-tanya dulu, balas aja pesan ini ya kak 😊',
      ].filter(Boolean).join('\n');

    case 'queue_completion':
      return [
        `${greet(p.customerName)} ✨`,
        `Mobil kakak sudah selesai dicuci${has(p.bayName) ? ` di ${p.bayName}` : ''}!`,
        has(p.orderNumber) ? `Nomor transaksi: ${p.orderNumber}.` : '',
        'Silakan menuju kasir ya kak. Terima kasih! 🚗',
      ].filter(Boolean).join('\n');

    case 'retention_offer':
      return [
        `${greet(p.customerName)} 😊`,
        'Sudah lama nih kakak nggak mampir — kami kangen mobil kakak!',
        has(p.offer) ? `Ada penawaran khusus buat kakak: ${p.offer}` : '',
        'Mau Irene bantu jadwalkan cuci berikutnya?',
      ].filter(Boolean).join('\n');

    case 'membership_recommendation':
      return [
        `${greet(p.customerName)} 😊`,
        'Dari pola cuci kakak, ada paket membership yang kelihatannya lebih hemat nih.',
        has(p.offer) ? `${p.offer}` : '',
        'Mau Irene jelaskan detailnya kak?',
      ].filter(Boolean).join('\n');

    // Staff-facing, not a customer message.
    case 'action_proposal_pending':
      return [
        '🤖 *Usulan tindakan menunggu persetujuan*',
        has(p.actionType) ? `Tindakan: ${p.actionType}` : '',
        has(p.reasoning) ? `Alasan: ${p.reasoning}` : '',
        has(p.confidence) ? `Keyakinan: ${p.confidence}` : '',
        'Buka dashboard untuk menyetujui atau menolak.',
      ].filter(Boolean).join('\n');

    case 'escalation':
      return [
        '🚨 *Percakapan dieskalasi ke tim*',
        has(p.from) ? `Dari: ${p.from}` : '',
        has(p.reason) ? `Alasan: ${p.reason}` : '',
      ].filter(Boolean).join('\n');

    default:
      return null;
  }
}
