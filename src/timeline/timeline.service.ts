import { Injectable } from '@nestjs/common';
import { LeadEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LeadNotFoundError } from '../common/errors/lead-not-found.error';

interface RecordEventInput {
  leadId: number;
  type: LeadEventType;
  performedByUserId: number;
  metadata?: Prisma.InputJsonValue;
  comment?: string;
}

type Tx = Omit<Prisma.TransactionClient, '$connect' | '$disconnect'>;

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

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

  /**
   * Full timeline for a lead in chronological order. 404 if the lead is
   * missing (rather than returning [], so callers can distinguish "no events"
   * — impossible in practice, LEAD_CREATED is always written — from "no lead").
   */
  async getForLead(leadId: number) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });
    if (!lead) throw new LeadNotFoundError(leadId);

    return this.prisma.leadEvent.findMany({
      where: { leadId },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        type: true,
        occurredAt: true,
        metadata: true,
        comment: true,
        performedBy: { select: { id: true, name: true, role: true } },
      },
    });
  }
}
