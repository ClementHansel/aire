import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
