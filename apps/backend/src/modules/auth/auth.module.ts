import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './auth.guard';
import { DatabasePoolProvider } from './database.provider';
import { ACCESS_TOKEN_EXPIRY_SECONDS } from '@aire/shared';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'aire-dev-secret'),
        signOptions: {
          expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, DatabasePoolProvider],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
