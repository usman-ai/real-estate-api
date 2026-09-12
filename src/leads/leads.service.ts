import { Injectable } from '@nestjs/common';
import { LeadEventType, LeadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TimelineService } from '../timeline/timeline.service';
import { PossibleDuplicateError } from '../common/errors/possible-duplicate.error';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateLeadDto } from './dto/create-lead.dto';

type Tx = Omit<Prisma.TransactionClient, '$connect' | '$disconnect'>;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
  ) {}

  async create(dto: CreateLeadDto, actor: AuthenticatedUser) {
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
