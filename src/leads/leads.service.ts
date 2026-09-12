import { Injectable } from '@nestjs/common';
import { Lead, LeadEventType, LeadStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { PossibleDuplicateError } from '../common/errors/possible-duplicate.error';
import { LeadNotFoundError } from '../common/errors/lead-not-found.error';
import { InvalidAgentError } from '../common/errors/invalid-agent.error';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateLeadDto } from './dto/create-lead.dto';
import { QualifyDto } from './dto/qualify.dto';
import { MarkNotQualifiedDto } from './dto/mark-not-qualified.dto';
import { AssignAgentDto } from './dto/assign-agent.dto';
import { ConvertLeadDto } from './dto/convert-lead.dto';
import { DropLeadDto } from './dto/drop-lead.dto';
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

  // --- Assign / Reassign (PAA → AGENT_ASSIGNED, or AA → AA) --------------

  async assign(leadId: number, actor: AuthenticatedUser, dto: AssignAgentDto): Promise<Lead> {
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(tx, leadId);

      const agent = await tx.user.findUnique({ where: { id: dto.agentId } });
      if (!agent || !agent.isActive) {
        throw new InvalidAgentError(dto.agentId, `Agent ${dto.agentId} not found or inactive`);
      }
      if (agent.role !== Role.AGENT) {
        throw new InvalidAgentError(
          dto.agentId,
          `User ${dto.agentId} has role ${agent.role}, not AGENT`,
        );
      }

      // State machine allows PENDING_AGENT_ASSIGNMENT → AGENT_ASSIGNED (first
      // assignment) and AGENT_ASSIGNED → AGENT_ASSIGNED (reassignment).
      this.stateMachine.assertTransition(lead.status, LeadStatus.AGENT_ASSIGNED, actor, lead);

      const isReassignment = lead.status === LeadStatus.AGENT_ASSIGNED;
      const previousAgentId = lead.assignedAgentId;

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.AGENT_ASSIGNED,
          assignedAgentId: dto.agentId,
        },
      });

      await this.timeline.record(tx, {
        leadId,
        type: isReassignment ? LeadEventType.AGENT_REASSIGNED : LeadEventType.AGENT_ASSIGNED,
        performedByUserId: actor.id,
        metadata: isReassignment
          ? { agentId: dto.agentId, previousAgentId }
          : { agentId: dto.agentId },
      });

      return updated;
    });
  }

  // --- Convert (AA → CONVERTED_PENDING_APPROVAL, assigned agent only) ----

  async convert(leadId: number, actor: AuthenticatedUser, dto: ConvertLeadDto): Promise<Lead> {
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(tx, leadId);
      this.stateMachine.assertTransition(
        lead.status,
        LeadStatus.CONVERTED_PENDING_APPROVAL,
        actor,
        lead,
      );

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.CONVERTED_PENDING_APPROVAL,
          convertedPropertyId: dto.propertyId,
          convertedUnitId: dto.unitId,
          convertedComment: dto.comment,
        },
      });

      await this.timeline.record(tx, {
        leadId,
        type: LeadEventType.LEAD_MARKED_CONVERTED,
        performedByUserId: actor.id,
        comment: dto.comment,
        metadata: { propertyId: dto.propertyId, unitId: dto.unitId },
      });

      return updated;
    });
  }

  // --- Drop (AA → DROPPED_PENDING_APPROVAL, assigned agent only) ---------

  async drop(leadId: number, actor: AuthenticatedUser, dto: DropLeadDto): Promise<Lead> {
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(tx, leadId);
      this.stateMachine.assertTransition(
        lead.status,
        LeadStatus.DROPPED_PENDING_APPROVAL,
        actor,
        lead,
      );

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: {
          status: LeadStatus.DROPPED_PENDING_APPROVAL,
          droppedReason: dto.reason,
          droppedComment: dto.comment,
        },
      });

      await this.timeline.record(tx, {
        leadId,
        type: LeadEventType.LEAD_MARKED_DROPPED,
        performedByUserId: actor.id,
        comment: dto.comment,
        metadata: { reason: dto.reason },
      });

      return updated;
    });
  }

  // --- Approve (CONVERTED/DROPPED PENDING_APPROVAL → CLOSED) --------------

  async approve(leadId: number, actor: AuthenticatedUser): Promise<Lead> {
    return this.prisma.$transaction(async (tx) => {
      const lead = await this.getLeadOrThrow(tx, leadId);
      // assertTransition rejects anything that isn't a *_PENDING_APPROVAL state
      // (only those have CLOSED as a valid target).
      this.stateMachine.assertTransition(lead.status, LeadStatus.CLOSED, actor, lead);

      const previousStatus = lead.status;

      const updated = await tx.lead.update({
        where: { id: leadId },
        data: { status: LeadStatus.CLOSED },
      });

      // Two events for a clean timeline: what got approved, then final close.
      await this.timeline.record(tx, {
        leadId,
        type: LeadEventType.OUTCOME_APPROVED,
        performedByUserId: actor.id,
        metadata: {
          approvedOutcome:
            previousStatus === LeadStatus.CONVERTED_PENDING_APPROVAL ? 'CONVERTED' : 'DROPPED',
        },
      });
      await this.timeline.record(tx, {
        leadId,
        type: LeadEventType.LEAD_CLOSED,
        performedByUserId: actor.id,
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
