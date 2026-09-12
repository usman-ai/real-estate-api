import { LeadStatus, Role } from '@prisma/client';
import { LeadStateMachine } from './lead-state-machine';
import { InvalidTransitionError } from '../../common/errors/invalid-transition.error';
import { LeadNotAccessibleError } from '../../common/errors/lead-not-accessible.error';

const actor = (role: Role, id = 42) => ({ id, role });
const lead = (assignedAgentId: number | null = null) => ({ assignedAgentId });

describe('LeadStateMachine', () => {
  let sm: LeadStateMachine;
  beforeEach(() => {
    sm = new LeadStateMachine();
  });

  describe('allowed transitions', () => {
    const cases: Array<[LeadStatus, LeadStatus, Role, boolean, string]> = [
      // [from, to, role, needsAssignedAgent, description]
      [LeadStatus.NEW, LeadStatus.LEAD_GENERATION_FOLLOW_UP, Role.LEAD_GENERATION, false, 'pickup by LG'],
      [LeadStatus.NEW, LeadStatus.LEAD_GENERATION_FOLLOW_UP, Role.LEAD_GENERATION_SUPERVISOR, false, 'pickup by LG supervisor'],
      [LeadStatus.LEAD_GENERATION_FOLLOW_UP, LeadStatus.QUALIFIED, Role.LEAD_GENERATION, false, 'qualify step 1'],
      [LeadStatus.LEAD_GENERATION_FOLLOW_UP, LeadStatus.NOT_QUALIFIED, Role.LEAD_GENERATION, false, 'mark not qualified'],
      [LeadStatus.QUALIFIED, LeadStatus.PENDING_AGENT_ASSIGNMENT, Role.LEAD_GENERATION_SUPERVISOR, false, 'qualify step 2'],
      [LeadStatus.PENDING_AGENT_ASSIGNMENT, LeadStatus.AGENT_ASSIGNED, Role.AGENT_SUPERVISOR, false, 'first assignment'],
      [LeadStatus.AGENT_ASSIGNED, LeadStatus.AGENT_ASSIGNED, Role.AGENT_SUPERVISOR, false, 'reassignment'],
      [LeadStatus.AGENT_ASSIGNED, LeadStatus.CONVERTED_PENDING_APPROVAL, Role.AGENT, true, 'convert by assigned agent'],
      [LeadStatus.AGENT_ASSIGNED, LeadStatus.DROPPED_PENDING_APPROVAL, Role.AGENT, true, 'drop by assigned agent'],
      [LeadStatus.CONVERTED_PENDING_APPROVAL, LeadStatus.CLOSED, Role.LEAD_GENERATION_SUPERVISOR, false, 'approve conversion'],
      [LeadStatus.DROPPED_PENDING_APPROVAL, LeadStatus.CLOSED, Role.LEAD_GENERATION_SUPERVISOR, false, 'approve drop'],
    ];

    it.each(cases)('%s → %s (%s) — role=%s, needsAssignedAgent=%s', (from, to, role, needsAssigned) => {
      const a = actor(role);
      const l = lead(needsAssigned ? a.id : 999);
      expect(() => sm.assertTransition(from, to, a, l)).not.toThrow();
    });

    it('returns the matched rule', () => {
      const rule = sm.assertTransition(
        LeadStatus.PENDING_AGENT_ASSIGNMENT,
        LeadStatus.AGENT_ASSIGNED,
        actor(Role.AGENT_SUPERVISOR),
        lead(),
      );
      expect(rule.to).toBe(LeadStatus.AGENT_ASSIGNED);
      expect(rule.requiredRoles).toContain(Role.AGENT_SUPERVISOR);
      expect(rule.actor).toBe('ANY');
    });
  });

  describe('disallowed transitions — spec examples', () => {
    const cases: Array<[LeadStatus, LeadStatus]> = [
      [LeadStatus.NEW, LeadStatus.AGENT_ASSIGNED],
      [LeadStatus.NEW, LeadStatus.CLOSED],
      [LeadStatus.NEW, LeadStatus.QUALIFIED],
      [LeadStatus.QUALIFIED, LeadStatus.CLOSED],
      [LeadStatus.AGENT_ASSIGNED, LeadStatus.CLOSED],
      [LeadStatus.LEAD_GENERATION_FOLLOW_UP, LeadStatus.AGENT_ASSIGNED],
      [LeadStatus.PENDING_AGENT_ASSIGNMENT, LeadStatus.CLOSED],
      [LeadStatus.PENDING_AGENT_ASSIGNMENT, LeadStatus.CONVERTED_PENDING_APPROVAL],
    ];

    it.each(cases)('%s → %s throws InvalidTransitionError even for LG_SUPERVISOR', (from, to) => {
      expect(() =>
        sm.assertTransition(from, to, actor(Role.LEAD_GENERATION_SUPERVISOR), lead()),
      ).toThrow(InvalidTransitionError);
    });
  });

  describe('terminal states have no outgoing transitions', () => {
    const allStatuses = Object.values(LeadStatus);

    it.each([LeadStatus.NOT_QUALIFIED, LeadStatus.CLOSED])('%s cannot transition anywhere', (from) => {
      for (const to of allStatuses) {
        expect(() =>
          sm.assertTransition(from, to, actor(Role.LEAD_GENERATION_SUPERVISOR), lead()),
        ).toThrow(InvalidTransitionError);
      }
    });
  });

  describe('role check', () => {
    it('valid target but wrong role → LeadNotAccessibleError (403)', () => {
      // Pickup requires LG or LG_SUPERVISOR
      expect(() =>
        sm.assertTransition(LeadStatus.NEW, LeadStatus.LEAD_GENERATION_FOLLOW_UP, actor(Role.AGENT), lead()),
      ).toThrow(LeadNotAccessibleError);
    });

    it('assign requires AGENT_SUPERVISOR', () => {
      expect(() =>
        sm.assertTransition(
          LeadStatus.PENDING_AGENT_ASSIGNMENT,
          LeadStatus.AGENT_ASSIGNED,
          actor(Role.LEAD_GENERATION),
          lead(),
        ),
      ).toThrow(LeadNotAccessibleError);
    });

    it('approve requires LG_SUPERVISOR (AGENT_SUPERVISOR cannot approve)', () => {
      expect(() =>
        sm.assertTransition(
          LeadStatus.CONVERTED_PENDING_APPROVAL,
          LeadStatus.CLOSED,
          actor(Role.AGENT_SUPERVISOR),
          lead(),
        ),
      ).toThrow(LeadNotAccessibleError);
    });
  });

  describe('ASSIGNED_AGENT actor constraint', () => {
    it('allows convert when actor is the assigned agent', () => {
      const a = actor(Role.AGENT, 10);
      expect(() =>
        sm.assertTransition(LeadStatus.AGENT_ASSIGNED, LeadStatus.CONVERTED_PENDING_APPROVAL, a, lead(10)),
      ).not.toThrow();
    });

    it('rejects convert when actor is a different agent', () => {
      const a = actor(Role.AGENT, 10);
      expect(() =>
        sm.assertTransition(LeadStatus.AGENT_ASSIGNED, LeadStatus.CONVERTED_PENDING_APPROVAL, a, lead(11)),
      ).toThrow(LeadNotAccessibleError);
    });

    it('rejects drop when actor is a different agent', () => {
      const a = actor(Role.AGENT, 10);
      expect(() =>
        sm.assertTransition(LeadStatus.AGENT_ASSIGNED, LeadStatus.DROPPED_PENDING_APPROVAL, a, lead(11)),
      ).toThrow(LeadNotAccessibleError);
    });

    it('rejects convert when lead has no assigned agent', () => {
      const a = actor(Role.AGENT, 10);
      expect(() =>
        sm.assertTransition(LeadStatus.AGENT_ASSIGNED, LeadStatus.CONVERTED_PENDING_APPROVAL, a, lead(null)),
      ).toThrow(LeadNotAccessibleError);
    });
  });

  describe('nextStatuses()', () => {
    it('returns reachable statuses from LEAD_GENERATION_FOLLOW_UP', () => {
      expect(sm.nextStatuses(LeadStatus.LEAD_GENERATION_FOLLOW_UP).sort()).toEqual(
        [LeadStatus.NOT_QUALIFIED, LeadStatus.QUALIFIED].sort(),
      );
    });

    it('returns [AGENT_ASSIGNED, CONVERTED_PENDING_APPROVAL, DROPPED_PENDING_APPROVAL] from AGENT_ASSIGNED (reassign + outcomes)', () => {
      expect(sm.nextStatuses(LeadStatus.AGENT_ASSIGNED).sort()).toEqual(
        [
          LeadStatus.AGENT_ASSIGNED,
          LeadStatus.CONVERTED_PENDING_APPROVAL,
          LeadStatus.DROPPED_PENDING_APPROVAL,
        ].sort(),
      );
    });

    it('returns [] for terminal states', () => {
      expect(sm.nextStatuses(LeadStatus.CLOSED)).toEqual([]);
      expect(sm.nextStatuses(LeadStatus.NOT_QUALIFIED)).toEqual([]);
    });
  });
});
