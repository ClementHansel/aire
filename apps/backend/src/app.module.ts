import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScopeModule } from './common/scope/scope.module';
import { PermissionsModule } from './common/permissions/permissions.module';
import { AuthModule } from './modules/auth';
import { AuditModule } from './modules/audit';
import { AdminModule } from './modules/admin';
import { BayModule } from './modules/bay';
import { CctvModule } from './modules/cctv';
import { MembershipModule } from './modules/membership';
import { NotificationModule, NotificationRendererModule } from './modules/notification';
import { OrderModule } from './modules/order';
import { ReportModule } from './modules/report';
import { ServiceModule } from './modules/service';
import { ProductModule } from './modules/product';
import { CustomerModule } from './modules/customer';
import { KioskModule } from './modules/kiosk';
import { AgentModule } from './modules/agent';
import { PaymentModule } from './modules/payment';
import { VoucherModule } from './modules/voucher';
import { EventsModule } from './modules/events';
import { JobMonitorModule } from './modules/job-monitor';
import { MonitoringModule } from './modules/monitoring';
import { InventoryModule } from './modules/inventory/inventory.module';
import { FinanceModule } from './modules/finance/finance.module';
import { SalesModule } from './modules/sales/sales.module';
import { HrModule } from './modules/hr/hr.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { ShiftModule } from './modules/shift/shift.module';
import { OutletModule } from './modules/outlet/outlet.module';
import { LegalEntityModule } from './modules/legal-entity';
import { PaymentMethodModule } from './modules/payment-method';
import { CatalogModule } from './modules/catalog';
import { AccessModule } from './modules/access';
import { VoucherTicketModule } from './modules/voucher-ticket';
import { PromotionModule } from './modules/promotion';
import { SettlementModule } from './modules/settlement';
import { AccountingModule } from './modules/accounting/accounting.module';
import { FinanceSetupModule } from './modules/finance-setup/finance-setup.module';
import { VehicleQueueModule } from './modules/vehicle-queue';
import { AgentConfigModule } from './modules/agent-config';
import { WhatsappModule } from './modules/whatsapp';
import { BookingModule } from './modules/booking';
import { AgentRegistryModule } from './modules/agent-registry';
import { TenantModulesModule } from './modules/tenant-modules/tenant-modules.module';
import { BrandingModule } from './modules/branding/branding.module';
import { RecipeModule } from './modules/recipe/recipe.module';
import { VehicleCatalogModule } from './modules/vehicle-catalog/vehicle-catalog.module';
import { MembershipCardModule } from './modules/membership-card/membership-card.module';
import { DocTemplateModule } from './modules/doc-template/doc-template.module';
import { PortalModule } from './modules/portal/portal.module';
import { AgentBridgeModule } from './modules/agent-bridge';
import { StorageModule } from './modules/storage';
import { MeModule } from './modules/me/me.module';
import { PosDeviceModule } from './modules/pos-device';
import { BridgeModule } from './modules/bridge';
import { DeviceRegistryModule } from './modules/device-registry';
import { DiscoveryModule } from './modules/discovery';
import { OnboardingModule } from './modules/onboarding';
import { RefundModule } from './modules/refund/refund.module';
import { CommissionModule } from './modules/commission/commission.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { TaxInvoiceModule } from './modules/tax-invoice/tax-invoice.module';
import { BarcodeModule } from './modules/barcode/barcode.module';
import { CampaignModule } from './modules/campaign';
import { LprModule } from './modules/lpr';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    StorageModule,
    ScopeModule,
    PermissionsModule,
    EventsModule,
    JobMonitorModule,
    MonitoringModule,
    AgentModule,
    AuthModule,
    AuditModule,
    AdminModule,
    BayModule,
    CctvModule,
    CustomerModule,
    KioskModule,
    MembershipModule,
    // Global: supplies NotificationRendererService to every sending module.
    NotificationRendererModule,
    NotificationModule,
    OrderModule,
    PaymentModule,
    ReportModule,
    ServiceModule,
    ProductModule,
    VoucherModule,
    InventoryModule,
    RecipeModule,
    VehicleCatalogModule,
    MembershipCardModule,
    DocTemplateModule,
    PortalModule,
    FinanceModule,
    SalesModule,
    HrModule,
    MeModule,
    PosDeviceModule,
    ProcurementModule,
    ShiftModule,
    OutletModule,
    LegalEntityModule,
    PaymentMethodModule,
    CatalogModule,
    AccessModule,
    VoucherTicketModule,
    PromotionModule,
    SettlementModule,
    AccountingModule,
    FinanceSetupModule,
    VehicleQueueModule,
    AgentConfigModule,
    WhatsappModule,
    BookingModule,
    AgentRegistryModule,
    TenantModulesModule,
    BrandingModule,
    AgentBridgeModule,
    BridgeModule,
    DeviceRegistryModule,
    DiscoveryModule,
    OnboardingModule,
    RefundModule,
    CommissionModule,
    FeedbackModule,
    BroadcastModule,
    TaxInvoiceModule,
    BarcodeModule,
    CampaignModule,
    LprModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
