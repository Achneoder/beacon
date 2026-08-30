import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { User } from '../users/user.entity.js';
import { Role } from '../roles/role.entity.js';
import { RefreshToken } from './refresh-token.entity.js';
import { OrganizationModule } from '../organizations/organization.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { JwtStrategy } from './jwt.strategy.js';

@Module({
  imports: [
    PassportModule,
    OrganizationModule,
    MikroOrmModule.forFeature([User, Role, RefreshToken]),
    // registerAsync, so JWT_SECRET is read after ConfigModule has loaded .env — the same
    // reason app.module.ts builds the ORM config through forRootAsync.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // jsonwebtoken types expiresIn as a template literal union; the value is an
        // env string, so it can only be validated at runtime.
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '15m') as `${number}m`,
          // Matches the pin in `jwt.strategy.ts` — signer and verifier must never be
          // free to disagree about which algorithms are acceptable.
          algorithm: 'HS256',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, JwtStrategy],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
