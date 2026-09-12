import { DomainError } from './domain-error';

export class PossibleDuplicateError extends DomainError {
  constructor(existingLeadIds: number[]) {
    super(
      'POSSIBLE_DUPLICATE',
      'Possible duplicate lead(s) found. Set confirmDuplicate:true to create anyway.',
      409,
      { existingLeadIds },
    );
  }
}
