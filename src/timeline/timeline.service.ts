import { Injectable } from '@nestjs/common';
import { LeadEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LeadNotFoundError } from '../common/errors/lead-not-found.error';
import { LeadAccessPolicy } from '../leads/policies/lead-access.policy';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: LeadAccessPolicy,
  ) {}

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
   * Full timeline for a lead in chronological order. Visibility is checked
   * via LeadAccessPolicy so an AGENT cannot read another AGENT's timeline
   * (404, same shape as "lead doesn't exist" to avoid ID enumeration).
   */
  async getForLead(leadId: number, actor: AuthenticatedUser) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, assignedAgentId: true },
    });
    if (!lead) throw new LeadNotFoundError(leadId);
    this.accessPolicy.assertCanView(actor, lead);

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
