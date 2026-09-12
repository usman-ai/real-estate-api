import { DomainError } from './domain-error';

/**
 * Raised when POST /leads/:id/assign receives an agentId that doesn't refer to
 * an active user with role=AGENT. Distinct from LEAD_NOT_ACCESSIBLE so callers
 * can distinguish "actor is unauthorized" from "target agent is invalid".
 */
export class InvalidAgentError extends DomainError {
  constructor(agentId: number, reason: string) {
    super('INVALID_AGENT', reason, 400, { agentId });
  }
}
