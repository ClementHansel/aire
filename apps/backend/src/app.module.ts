import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth';
import { AuditModule } from './modules/audit';
import { AdminModule } from './modules/admin';
import { ChatbotModule } from './modules/ai';
import { AIModule } from './modules/ai';
import { BayModule } from './modules/bay';
import { CctvModule } from './modules/cctv';
import { MembershipModule } from './modules/membership';
import { NotificationModule } from './modules/notification';
import { OrderModule } from './modules/order';
import { ReceiptModule } from './modules/receipt';
import { ReportModule } from './modules/report';
import { ServiceModule } from './modules/service';
import { CustomerModule } from './modules/customer';
import { KioskModule } from './modules/kiosk';
import { AgentModule } from './modules/agent';
import { PaymentModule } from './modules/payment';
import { VoucherModule } from './modules/voucher';
import { EventsModule } from './modules/events';
import { MonitoringModule } from './modules/monitoring';
import { InventoryModule } from './modules/inventory/inventory.module';
import { FinanceModule } from './modules/finance/finance.module';
import { SalesModule } from './modules/sales/sales.module';
import { HrModule } from './modules/hr/hr.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { ShiftModule } from './modules/shift/shift.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventsModule,
    MonitoringModule,
    AgentModule,
    AIModule,
    AuthModule,
    AuditModule,
    AdminModule,
    BayModule,
    CctvModule,
    ChatbotModule,
    CustomerModule,
    KioskModule,
    MembershipModule,
    NotificationModule,
    OrderModule,
    PaymentModule,
    ReceiptModule,
    ReportModule,
    ServiceModule,
    VoucherModule,
    InventoryModule,
    FinanceModule,
    SalesModule,
    HrModule,
    ProcurementModule,
    ShiftModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
