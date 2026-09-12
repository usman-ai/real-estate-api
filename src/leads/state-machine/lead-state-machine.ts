import { Injectable } from '@nestjs/common';
import { LeadStatus, Role } from '@prisma/client';
import { InvalidTransitionError } from '../../common/errors/invalid-transition.error';
import { LeadNotAccessibleError } from '../../common/errors/lead-not-accessible.error';
import { TRANSITIONS, TransitionRule } from './transitions';

export interface TransitionActor {
  id: number;
  role: Role;
}

export interface TransitionLead {
  assignedAgentId: number | null;
}

@Injectable()
export class LeadStateMachine {
  /**
   * Validates a proposed status change end-to-end:
   *   1. `to` must be reachable from `from`             → InvalidTransitionError (409)
   *   2. `actor.role` must satisfy the transition's role list → LeadNotAccessibleError (403)
   *   3. ASSIGNED_AGENT constraint must hold when required    → LeadNotAccessibleError (403)
   *
   * Returns the matched rule so callers can, e.g., branch on `requiredRoles`.
   */
  assertTransition(
    from: LeadStatus,
    to: LeadStatus,
    actor: TransitionActor,
    lead: TransitionLead,
  ): TransitionRule {
    const rule = TRANSITIONS[from].find((r) => r.to === to);
    if (!rule) throw new InvalidTransitionError(from, to);

    if (!rule.requiredRoles.includes(actor.role)) {
      throw new LeadNotAccessibleError(
        `Role ${actor.role} is not permitted to perform ${from} → ${to}`,
        { requiredRoles: rule.requiredRoles, actorRole: actor.role },
      );
    }

    if (rule.actor === 'ASSIGNED_AGENT' && lead.assignedAgentId !== actor.id) {
      throw new LeadNotAccessibleError(
        'Only the assigned agent can perform this action',
        { constraint: 'ASSIGNED_AGENT' },
      );
    }

    return rule;
  }

  /** Reachable next statuses from `from`, ignoring actor constraints. */
  nextStatuses(from: LeadStatus): LeadStatus[] {
    return Array.from(new Set(TRANSITIONS[from].map((r) => r.to)));
  }
}
