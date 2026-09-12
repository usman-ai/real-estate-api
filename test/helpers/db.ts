import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Truncate lead-scoped tables between tests. Users survive so their IDs
 * (asserted in helpers/auth.ts) stay stable across specs.
 */
export async function resetLeads(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "LeadEvent", "Lead" RESTART IDENTITY CASCADE',
  );
}
