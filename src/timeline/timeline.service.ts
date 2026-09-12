import { Injectable } from '@nestjs/common';
import { LeadEventType, Prisma } from '@prisma/client';

interface RecordEventInput {
  leadId: number;
  type: LeadEventType;
  performedByUserId: number;
  metadata?: Prisma.InputJsonValue;
  comment?: string;
}

// Prisma's interactive transaction client type — narrower than PrismaClient and
// what callers get inside `prisma.$transaction(async (tx) => ...)`.
type Tx = Omit<Prisma.TransactionClient, '$connect' | '$disconnect'>;

@Injectable()
export class TimelineService {
  /**
   * Always called with the caller's transaction client so the state change and
   * the timeline entry either both persist or neither does.
   */
  record(tx: Tx, input: RecordEventInput) {
    return tx.leadEvent.create({
      data: {
        leadId: input.leadId,
        type: input.type,
        performedByUserId: input.performedByUserId,
        metadata: input.metadata,
        comment: input.comment,
      },
    });
  }
}
