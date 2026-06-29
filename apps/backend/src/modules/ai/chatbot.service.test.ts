import { describe, it, expect, beforeEach } from 'vitest';
import { ChatbotService, ChatbotIntent } from './chatbot.service';

describe('ChatbotService', () => {
  let service: ChatbotService;

  beforeEach(() => {
    service = new ChatbotService();
  });

  describe('recognizeIntent', () => {
    describe('membership_check intent', () => {
      it('should recognize "member" keyword', () => {
        expect(service.recognizeIntent('Cek status member saya')).toBe(
          ChatbotIntent.MembershipCheck,
        );
      });

      it('should recognize "membership" keyword', () => {
        expect(service.recognizeIntent('What is my membership status?')).toBe(
          ChatbotIntent.MembershipCheck,
        );
      });

      it('should recognize "kuota" keyword', () => {
        expect(service.recognizeIntent('Berapa sisa kuota saya?')).toBe(
          ChatbotIntent.MembershipCheck,
        );
      });

      it('should recognize "sisa cuci" keyword', () => {
        expect(service.recognizeIntent('Mau tanya sisa cuci berapa ya')).toBe(
          ChatbotIntent.MembershipCheck,
        );
      });

      it('should recognize "expired" keyword', () => {
        expect(service.recognizeIntent('Kapan expired membership saya?')).toBe(
          ChatbotIntent.MembershipCheck,
        );
      });

      it('should recognize "masa aktif" keyword', () => {
        expect(service.recognizeIntent('Masa aktif member saya sampai kapan?')).toBe(
          ChatbotIntent.MembershipCheck,
        );
      });
    });

    describe('order_status intent', () => {
      it('should recognize "order" keyword', () => {
        expect(service.recognizeIntent('Where is my order?')).toBe(
          ChatbotIntent.OrderStatus,
        );
      });

      it('should recognize "pesanan" keyword', () => {
        expect(service.recognizeIntent('Status pesanan saya gimana?')).toBe(
          ChatbotIntent.OrderStatus,
        );
      });

      it('should recognize "antrian" keyword', () => {
        expect(service.recognizeIntent('Nomor antrian saya berapa?')).toBe(
          ChatbotIntent.OrderStatus,
        );
      });

      it('should recognize "tracking" keyword', () => {
        expect(service.recognizeIntent('Can I track my wash?')).toBe(
          ChatbotIntent.OrderStatus,
        );
      });
    });

    describe('book_appointment intent', () => {
      it('should recognize "booking" keyword', () => {
        expect(service.recognizeIntent('Mau booking cuci mobil besok')).toBe(
          ChatbotIntent.BookAppointment,
        );
      });

      it('should recognize "reservasi" keyword', () => {
        expect(service.recognizeIntent('Bisa reservasi untuk jam 10?')).toBe(
          ChatbotIntent.BookAppointment,
        );
      });

      it('should recognize "schedule" keyword', () => {
        expect(service.recognizeIntent('I want to schedule a wash')).toBe(
          ChatbotIntent.BookAppointment,
        );
      });

      it('should recognize "jam buka" keyword', () => {
        expect(service.recognizeIntent('Jam buka kapan ya?')).toBe(
          ChatbotIntent.BookAppointment,
        );
      });
    });

    describe('general_info intent', () => {
      it('should recognize "harga" keyword', () => {
        expect(service.recognizeIntent('Berapa harga cuci mobil?')).toBe(
          ChatbotIntent.GeneralInfo,
        );
      });

      it('should recognize "price" keyword', () => {
        expect(service.recognizeIntent('What is the price for basic wash?')).toBe(
          ChatbotIntent.GeneralInfo,
        );
      });

      it('should recognize "alamat" keyword', () => {
        expect(service.recognizeIntent('Alamat outlet mana aja?')).toBe(
          ChatbotIntent.GeneralInfo,
        );
      });

      it('should recognize "lokasi" keyword', () => {
        expect(service.recognizeIntent('Lokasi outlet yang buka')).toBe(
          ChatbotIntent.GeneralInfo,
        );
      });

      it('should recognize "layanan" keyword', () => {
        expect(service.recognizeIntent('Ada layanan apa aja?')).toBe(
          ChatbotIntent.GeneralInfo,
        );
      });
    });

    describe('no intent (routes to human)', () => {
      it('should return null for empty message', () => {
        expect(service.recognizeIntent('')).toBeNull();
      });

      it('should return null for whitespace-only message', () => {
        expect(service.recognizeIntent('   ')).toBeNull();
      });

      it('should return null for unrecognized messages', () => {
        expect(service.recognizeIntent('hello there how are you')).toBeNull();
      });

      it('should return null for random characters', () => {
        expect(service.recognizeIntent('asdfghjkl 12345')).toBeNull();
      });
    });

    describe('case insensitivity', () => {
      it('should match regardless of case', () => {
        expect(service.recognizeIntent('CEK STATUS MEMBER SAYA')).toBe(
          ChatbotIntent.MembershipCheck,
        );
      });

      it('should match mixed case', () => {
        expect(service.recognizeIntent('Mau Booking Cuci')).toBe(
          ChatbotIntent.BookAppointment,
        );
      });
    });

    describe('multi-keyword scoring', () => {
      it('should prefer intent with more keyword matches', () => {
        // "member" + "sisa" + "kuota" = 3 hits for membership_check
        expect(service.recognizeIntent('sisa kuota member saya berapa?')).toBe(
          ChatbotIntent.MembershipCheck,
        );
      });
    });
  });

  describe('handleMessage', () => {
    it('should return a response with recognized intent and reply', async () => {
      const result = await service.handleMessage(
        '628123456789',
        'Cek status member saya',
      );

      expect(result.intent).toBe(ChatbotIntent.MembershipCheck);
      expect(result.reply).toContain('membership');
      expect(result.routedToHuman).toBe(false);
    });

    it('should route unrecognized messages to human operator', async () => {
      const result = await service.handleMessage(
        '628123456789',
        'hello random message xyz',
      );

      expect(result.routedToHuman).toBe(true);
      expect(result.reply).toContain('operator');
    });

    it('should include phone in metadata', async () => {
      const result = await service.handleMessage(
        '628999888777',
        'Harga cuci mobil berapa?',
      );

      expect(result.metadata?.phone).toBe('628999888777');
    });

    it('should route to human when chatbot is disabled for tenant', async () => {
      service.setTenantConfig('tenant-123', { enabled: false });

      const result = await service.handleMessage(
        '628123456789',
        'Cek status member saya',
        'tenant-123',
      );

      expect(result.routedToHuman).toBe(true);
      expect(result.metadata?.reason).toBe('chatbot_disabled');
    });

    it('should process normally when chatbot is enabled for tenant', async () => {
      service.setTenantConfig('tenant-456', { enabled: true });

      const result = await service.handleMessage(
        '628123456789',
        'Berapa harga cuci?',
        'tenant-456',
      );

      expect(result.intent).toBe(ChatbotIntent.GeneralInfo);
      expect(result.routedToHuman).toBe(false);
    });
  });

  describe('getReply', () => {
    it('should return default reply when no tenant config exists', () => {
      const reply = service.getReply(ChatbotIntent.MembershipCheck);
      expect(reply).toContain('membership');
    });

    it('should return custom reply when tenant has custom responses', () => {
      service.setTenantConfig('tenant-custom', {
        enabled: true,
        customResponses: {
          [ChatbotIntent.MembershipCheck]: 'Custom membership response here',
        },
      });

      const reply = service.getReply(ChatbotIntent.MembershipCheck, 'tenant-custom');
      expect(reply).toBe('Custom membership response here');
    });

    it('should fall back to default when tenant has no custom response for intent', () => {
      service.setTenantConfig('tenant-partial', {
        enabled: true,
        customResponses: {
          [ChatbotIntent.GeneralInfo]: 'Custom general info',
        },
      });

      const reply = service.getReply(ChatbotIntent.OrderStatus, 'tenant-partial');
      expect(reply).toContain('pesanan');
    });
  });

  describe('setTenantConfig / getTenantConfig', () => {
    it('should store and retrieve tenant configuration', () => {
      service.setTenantConfig('tenant-abc', {
        enabled: true,
        greeting: 'Selamat datang!',
      });

      const config = service.getTenantConfig('tenant-abc');
      expect(config).toBeDefined();
      expect(config!.enabled).toBe(true);
      expect(config!.greeting).toBe('Selamat datang!');
    });

    it('should return undefined for unconfigured tenant', () => {
      expect(service.getTenantConfig('unknown-tenant')).toBeUndefined();
    });

    it('should overwrite existing config', () => {
      service.setTenantConfig('tenant-x', { enabled: true });
      service.setTenantConfig('tenant-x', { enabled: false });

      const config = service.getTenantConfig('tenant-x');
      expect(config!.enabled).toBe(false);
    });
  });
});
