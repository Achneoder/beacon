import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { createOrmConfig } from './mikro-orm.config.js';
import { MailModule } from './common/mail/mail.module.js';
import { StorageModule } from './common/storage/storage.module.js';
import { SearchModule } from './common/search/search.module.js';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { PermissionsGuard } from './common/auth/permissions.guard.js';
import { DEFAULT_THROTTLE_LIMIT } from './common/auth/throttle.js';
import { HealthModule } from './modules/health/health.module.js';
import { InstanceModule } from './modules/instance/instance.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard.js';
import { OrganizationModule } from './modules/organizations/organization.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { DepartmentsModule } from './modules/departments/departments.module.js';
import { TeamsModule } from './modules/teams/teams.module.js';
import { InvitationsModule } from './modules/invitations/invitations.module.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { AbsencesModule } from './modules/absences/absences.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { SearchModule as SearchFeatureModule } from './modules/search/search.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SsoModule } from './modules/sso/sso.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createOrmConfig(config.getOrThrow<string>('DATABASE_URL')),
    }),
    // A baseline limit for every route; the password endpoints tighten it further.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: DEFAULT_THROTTLE_LIMIT }]),
    MailModule,
    StorageModule,
    // The seam only. The feature that uses it is `SearchFeatureModule`, last in the
    // list — it imports DocumentsModule and UsersModule, which inject this one.
    SearchModule,
    // Global, like StorageModule and SearchModule — SsoService injects SecretCipher
    // without importing this module itself.
    CryptoModule,
    HealthModule,
    InstanceModule,
    AuthModule,
    OrganizationModule,
    RolesModule,
    UsersModule,
    DepartmentsModule,
    TeamsModule,
    InvitationsModule,
    AttendanceModule,
    AbsencesModule,
    DocumentsModule,
    SearchFeatureModule,
    ReportsModule,
    SsoModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Order matters: authenticate first (401 for anonymous), then authorize (403).
    // Requests are authenticated by default — handlers opt out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
