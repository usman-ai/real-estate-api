import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { LeadNotFoundError } from '../../common/errors/lead-not-found.error';

interface AccessCheckLead {
  id: number;
  assignedAgentId: number | null;
}

/**
 * Central per-lead visibility policy.
 *
 * Rules (see README "Assumptions"):
 *   AGENT                      → own assigned leads only
 *   AGENT_SUPERVISOR           → all leads
 *   LEAD_GENERATION            → all leads
 *   LEAD_GENERATION_SUPERVISOR → all leads
 */
@Injectable()
export class LeadAccessPolicy {
  /** SQL-level `WHERE` fragment for GET /leads so hidden rows never hit the network. */
  filterForList(actor: AuthenticatedUser): Prisma.LeadWhereInput {
    if (actor.role === Role.AGENT) {
      return { assignedAgentId: actor.id };
    }
    return {};
  }

  /**
   * Guard for single-lead reads. Throws LeadNotFoundError (404) rather than
   * ForbiddenException (403) so an unauthorized caller cannot distinguish
   * "lead 42 exists but isn't yours" from "lead 42 doesn't exist" and thus
   * cannot enumerate IDs.
   */
  assertCanView(actor: AuthenticatedUser, lead: AccessCheckLead): void {
    if (actor.role !== Role.AGENT) return;
    if (lead.assignedAgentId !== actor.id) throw new LeadNotFoundError(lead.id);
  }
}
