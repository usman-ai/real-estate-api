import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    UsersModule,
    AuthModule,
  ],
  providers: [
    // JwtAuthGuard runs first: authenticates every request (bypassed by @Public).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // RolesGuard runs after: checks @Roles(...) metadata against the authenticated user.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
