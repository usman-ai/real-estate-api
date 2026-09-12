import { Injectable } from '@nestjs/common';
import { Lead, LeadEventType, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { PossibleDuplicateError } from '../common/errors/possible-duplicate.error';
import { LeadNotFoundError } from '../common/errors/lead-not-found.error';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateLeadDto } from './dto/create-lead.dto';
import { QualifyDto } from './dto/qualify.dto';
import { MarkNotQualifiedDto } from './dto/mark-not-qualified.dto';
import { LeadStateMachine } from './state-machine/lead-state-machine';

type Tx = Omit<Prisma.TransactionClient, '$connect' | '$disconnect'>;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly stateMachine: LeadStateMachine,
  ) {}

  // --- Create -------------------------------------------------------------

  async create(dto: CreateLeadDto, actor: AuthenticatedUser): Promise<Lead> {
    return this.prisma.$transaction(async (tx) => {
      const duplicateIds = await this.findPossibleDuplicates(tx, dto);
      if (duplicateIds.length > 0 && !dto.confirmDuplicate) {
        throw new PossibleDuplicateError(duplicateIds);
      }

      const lead = await tx.lead.create({
        data: {
          name: dto.name,
          phone: dto.phone,
          whatsappNumber: dto.whatsappNumber,
          email: dto.email,
          source: dto.source,
          campaign: dto.campaign,
          interestedLocation: dto.interestedLocation,
          propertyType: dto.propertyType,
          bedrooms: dto.bedrooms,
          budgetFrom: dto.budgetFrom,
          budgetTo: dto.budgetTo,
          movingDate: dto.movingDate ? new Date(dto.movingDate) : undefined,
          priority: dto.priority,
          status: LeadStatus.NEW,
          createdByUserId: actor.id,
        },
      });

      await this.timeline.record(tx, {
        leadId: lead.id,
        type: LeadEventType.LEAD_CREATED,
        performedByUserId: actor.id,
        metadata:
          duplicateIds.length > 0
            ? { duplicateOfIds: duplicateIds, createdWithConfirmDuplicate: true }
            : undefined,
      });

      return lead;
    });
  }

  // --- Pickup (NEW → LEAD_GENERATION_FOLLOW_UP) ---------------------------

  async pickup(leadId: number, actor: AuthenticatedUser): Promise<Lead> {
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(tx, leadId);
      this.stateMachine.assertTransition(
        lead.status,
        LeadStatus.LEAD_GENERATION_FOLLOW_UP,
        actor,
        lead,
      );

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: { status: LeadStatus.LEAD_GENERATION_FOLLOW_UP },
      });

      await this.timeline.record(tx, {
        leadId,
        type: LeadEventType.QUALIFICATION_STARTED,
        performedByUserId: actor.id,
      });

      return updated;
    });
  }

  // --- Qualify (LGFU → QUALIFIED → PENDING_AGENT_ASSIGNMENT, atomic) ------

  async qualify(leadId: number, actor: AuthenticatedUser, dto: QualifyDto): Promise<Lead> {
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(tx, leadId);

      // Assert both hops of the spec's diagram in one place. We collapse the
      // persisted status directly to PENDING_AGENT_ASSIGNMENT since QUALIFIED
      // is a transient state, but both audit events are emitted.
      this.stateMachine.assertTransition(lead.status, LeadStatus.QUALIFIED, actor, lead);
      this.stateMachine.assertTransition(
        LeadStatus.QUALIFIED,
        LeadStatus.PENDING_AGENT_ASSIGNMENT,
        actor,
        lead,
      );

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.PENDING_AGENT_ASSIGNMENT,
          qualificationComment: dto.qualificationComment,
          interestedLocation: dto.interestedLocation,
          budgetFrom: dto.budgetFrom,
          budgetTo: dto.budgetTo,
        },
      });

      await this.timeline.record(tx, {
        leadId,
        type: LeadEventType.LEAD_QUALIFIED,
        performedByUserId: actor.id,
        comment: dto.qualificationComment,
        metadata: {
          interestedLocation: updated.interestedLocation ?? null,
          budgetFrom: updated.budgetFrom?.toString() ?? null,
          budgetTo: updated.budgetTo?.toString() ?? null,
        },
      });
      await this.timeline.record(tx, {
        leadId,
        type: LeadEventType.PENDING_AGENT_ASSIGNMENT,
        performedByUserId: actor.id,
      });

      return updated;
    });
  }

  // --- Mark not qualified (LGFU → NOT_QUALIFIED, terminal) ----------------

  async markNotQualified(
    leadId: number,
    actor: AuthenticatedUser,
    dto: MarkNotQualifiedDto,
  ): Promise<Lead> {
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(tx, leadId);
      this.stateMachine.assertTransition(lead.status, LeadStatus.NOT_QUALIFIED, actor, lead);

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.NOT_QUALIFIED,
          notQualifiedReason: dto.reason,
          notQualifiedComment: dto.comment,
        },
      });

      await this.timeline.record(tx, {
        leadId,
        type: LeadEventType.LEAD_MARKED_NOT_QUALIFIED,
        performedByUserId: actor.id,
        comment: dto.comment,
        metadata: { reason: dto.reason },
      });

      return updated;
    });
  }

  // --- Helpers ------------------------------------------------------------

  private async getLeadOrThrow(tx: Tx, id: number): Promise<Lead> {
    const lead = await tx.lead.findUnique({ where: { id } });
    if (!lead) throw new LeadNotFoundError(id);
    return lead;
  }

  private async findPossibleDuplicates(tx: Tx, dto: CreateLeadDto): Promise<number[]> {
    const clauses: Prisma.LeadWhereInput[] = [];
    if (dto.phone) clauses.push({ phone: dto.phone });
    if (dto.whatsappNumber) clauses.push({ whatsappNumber: dto.whatsappNumber });
    if (dto.email) clauses.push({ email: { equals: dto.email, mode: 'insensitive' } });
    if (clauses.length === 0) return [];

    const rows = await tx.lead.findMany({
      where: { OR: clauses },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => r.id);
  }
}
