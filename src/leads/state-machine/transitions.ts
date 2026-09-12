import { LeadStatus, Role } from '@prisma/client';

/**
 * ANY:            any actor with a permitted role may perform the transition
 * ASSIGNED_AGENT: additionally requires actor.id === lead.assignedAgentId
 */
export type ActorConstraint = 'ANY' | 'ASSIGNED_AGENT';

export interface TransitionRule {
  to: LeadStatus;
  requiredRoles: Role[];
  actor: ActorConstraint;
}

/**
 * Single source of truth for the workflow. Every controller/service action goes
 * through LeadStateMachine.assertTransition() which reads this table.
 *
 * Notes on non-obvious rules:
 *  - `QUALIFIED → PENDING_AGENT_ASSIGNMENT` is emitted in the same transaction
 *    as `LEAD_GENERATION_FOLLOW_UP → QUALIFIED` inside the `qualify` handler;
 *    QUALIFIED is a transient state and never persists across requests.
 *  - `AGENT_ASSIGNED → AGENT_ASSIGNED` is the reassignment self-loop. Kept
 *    here so authz + audit go through the same machinery as first assignment.
 *  - NOT_QUALIFIED and CLOSED are terminal (empty outgoing list).
 */
export const TRANSITIONS: Record<LeadStatus, TransitionRule[]> = {
  [LeadStatus.NEW]: [
    { to: LeadStatus.LEAD_GENERATION_FOLLOW_UP, requiredRoles: [Role.LEAD_GENERATION, Role.LEAD_GENERATION_SUPERVISOR], actor: 'ANY' },
  ],
  [LeadStatus.LEAD_GENERATION_FOLLOW_UP]: [
    { to: LeadStatus.QUALIFIED,     requiredRoles: [Role.LEAD_GENERATION, Role.LEAD_GENERATION_SUPERVISOR], actor: 'ANY' },
    { to: LeadStatus.NOT_QUALIFIED, requiredRoles: [Role.LEAD_GENERATION, Role.LEAD_GENERATION_SUPERVISOR], actor: 'ANY' },
  ],
  [LeadStatus.QUALIFIED]: [
    { to: LeadStatus.PENDING_AGENT_ASSIGNMENT, requiredRoles: [Role.LEAD_GENERATION, Role.LEAD_GENERATION_SUPERVISOR], actor: 'ANY' },
  ],
  [LeadStatus.PENDING_AGENT_ASSIGNMENT]: [
    { to: LeadStatus.AGENT_ASSIGNED, requiredRoles: [Role.AGENT_SUPERVISOR], actor: 'ANY' },
  ],
  [LeadStatus.AGENT_ASSIGNED]: [
    { to: LeadStatus.AGENT_ASSIGNED,             requiredRoles: [Role.AGENT_SUPERVISOR], actor: 'ANY' }, // reassign
    { to: LeadStatus.CONVERTED_PENDING_APPROVAL, requiredRoles: [Role.AGENT],            actor: 'ASSIGNED_AGENT' },
    { to: LeadStatus.DROPPED_PENDING_APPROVAL,   requiredRoles: [Role.AGENT],            actor: 'ASSIGNED_AGENT' },
  ],
  [LeadStatus.CONVERTED_PENDING_APPROVAL]: [
    { to: LeadStatus.CLOSED, requiredRoles: [Role.LEAD_GENERATION_SUPERVISOR], actor: 'ANY' },
  ],
  [LeadStatus.DROPPED_PENDING_APPROVAL]: [
    { to: LeadStatus.CLOSED, requiredRoles: [Role.LEAD_GENERATION_SUPERVISOR], actor: 'ANY' },
  ],
  [LeadStatus.NOT_QUALIFIED]: [],
  [LeadStatus.CLOSED]: [],
};
