import { Global, Module } from '@nestjs/common';
import { NotificationRendererService } from './notification-renderer.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * The renderer lives in its own GLOBAL module because message text is needed
 * everywhere — voucher, booking, feedback, portal, refund, order, queue — while
 * the renderer itself depends on nothing but the database pool.
 *
 * Routing it through NotificationModule instead would drag WhatsappModule (which
 * NotificationModule forward-references) into every one of those modules, and
 * WhatsappModule's own senders could not reach it at all without a cycle.
 */
@Global()
@Module({
  providers: [NotificationRendererService, DatabasePoolProvider],
  exports: [NotificationRendererService],
})
export class NotificationRendererModule {}
