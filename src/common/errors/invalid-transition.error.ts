import { LeadStatus } from '@prisma/client';
import { DomainError } from './domain-error';

export class InvalidTransitionError extends DomainError {
  constructor(from: LeadStatus, to: LeadStatus) {
    super(
      'INVALID_TRANSITION',
      `Cannot transition lead from ${from} to ${to}`,
      409,
      { from, to },
    );
  }
}
