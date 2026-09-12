import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Transaction timeout bumped from the 5s default so audit-event writes inside
// a state-change transaction don't spuriously time out under CI load.
const INTERACTIVE_TRANSACTION_TIMEOUT_MS = 10_000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      transactionOptions: {
        timeout: INTERACTIVE_TRANSACTION_TIMEOUT_MS,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
