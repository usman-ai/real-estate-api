import { DomainError } from './domain-error';

/**
 * Thrown when a specific lead cannot be acted on by the caller even though
 * their coarse role passed the RolesGuard — e.g. an AGENT trying to convert
 * a lead assigned to a different AGENT, or a role not permitted for the
 * requested transition.
 */
export class LeadNotAccessibleError extends DomainError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('LEAD_NOT_ACCESSIBLE', reason, 403, details);
  }
}
