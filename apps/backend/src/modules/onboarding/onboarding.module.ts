import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { DatabasePoolProvider } from '../auth/database.provider';

/**
 * Onboarding wizard status/lifecycle. The gate itself (OnboardingCompleteGuard)
 * is applied at the controller level on operational modules — NOT globally —
 * because it reads the authenticated user, which the controller-scoped
 * JwtAuthGuard populates; a global guard would run before auth and see no user.
 */
@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService, DatabasePoolProvider],
  exports: [OnboardingService],
})
export class OnboardingModule {}
