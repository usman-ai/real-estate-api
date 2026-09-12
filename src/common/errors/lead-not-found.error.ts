import { DomainError } from './domain-error';

/**
 * 404 for both "lead does not exist" and "you cannot see this lead" so
 * unprivileged callers cannot enumerate lead IDs from status codes.
 */
export class LeadNotFoundError extends DomainError {
  constructor(id: number) {
    super('NOT_FOUND', `Lead ${id} not found`, 404, { leadId: id });
  }
}
