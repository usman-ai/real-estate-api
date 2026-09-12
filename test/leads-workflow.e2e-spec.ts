import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app';
import { resetLeads } from './helpers/db';
import { USERS, bearer, login } from './helpers/auth';

describe('Lead workflow (e2e)', () => {
  let app: INestApplication;
  let LG: string, LGS: string, ASUP: string, AA: string, AB: string;

  const createLead = () =>
    request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', bearer(LG))
      .send({ name: 'Test', phone: '+97400000001', source: 'FACEBOOK' })
      .expect(201);

  beforeAll(async () => {
    app = await createTestApp();
    [LG, LGS, ASUP, AA, AB] = await Promise.all([
      login(app, 'LEAD_GENERATION'),
      login(app, 'LEAD_GENERATION_SUPERVISOR'),
      login(app, 'AGENT_SUPERVISOR'),
      login(app, 'AGENT_A'),
      login(app, 'AGENT_B'),
    ]);
  });
  afterAll(async () => app.close());
  beforeEach(async () => resetLeads(app));

  it('full CONVERT happy path: NEW → CLOSED', async () => {
    const { body: created } = await createLead();
    const id = created.id;

    let res = await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
    expect(res.body.status).toBe('LEAD_GENERATION_FOLLOW_UP');

    res = await request(app.getHttpServer())
      .post(`/leads/${id}/qualify`)
      .set('Authorization', bearer(LG))
      .send({ qualificationComment: '2BR West Bay', budgetFrom: 6000, budgetTo: 8000 })
      .expect(200);
    expect(res.body.status).toBe('PENDING_AGENT_ASSIGNMENT');
    expect(res.body.qualificationComment).toBe('2BR West Bay');

    res = await request(app.getHttpServer())
      .post(`/leads/${id}/assign`)
      .set('Authorization', bearer(ASUP))
      .send({ agentId: USERS.AGENT_A.id })
      .expect(200);
    expect(res.body.status).toBe('AGENT_ASSIGNED');
    expect(res.body.assignedAgentId).toBe(USERS.AGENT_A.id);

    res = await request(app.getHttpServer())
      .post(`/leads/${id}/convert`)
      .set('Authorization', bearer(AA))
      .send({ propertyId: 123, unitId: 456, comment: 'Agreed' })
      .expect(200);
    expect(res.body.status).toBe('CONVERTED_PENDING_APPROVAL');
    expect(res.body.convertedPropertyId).toBe(123);

    res = await request(app.getHttpServer()).post(`/leads/${id}/approve`).set('Authorization', bearer(LGS)).expect(200);
    expect(res.body.status).toBe('CLOSED');
  });

  it('full DROP happy path: NEW → CLOSED (via DROPPED_PENDING_APPROVAL)', async () => {
    const { body: created } = await createLead();
    const id = created.id;
    await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
    await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);
    await request(app.getHttpServer())
      .post(`/leads/${id}/assign`)
      .set('Authorization', bearer(ASUP))
      .send({ agentId: USERS.AGENT_A.id })
      .expect(200);
    const dropRes = await request(app.getHttpServer())
      .post(`/leads/${id}/drop`)
      .set('Authorization', bearer(AA))
      .send({ reason: 'BUDGET_ISSUE', comment: 'Too low' })
      .expect(200);
    expect(dropRes.body.status).toBe('DROPPED_PENDING_APPROVAL');
    expect(dropRes.body.droppedReason).toBe('BUDGET_ISSUE');

    const closeRes = await request(app.getHttpServer())
      .post(`/leads/${id}/approve`)
      .set('Authorization', bearer(LGS))
      .expect(200);
    expect(closeRes.body.status).toBe('CLOSED');
  });

  it('NOT_QUALIFIED terminal path', async () => {
    const { body: created } = await createLead();
    const id = created.id;
    await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
    const res = await request(app.getHttpServer())
      .post(`/leads/${id}/not-qualified`)
      .set('Authorization', bearer(LG))
      .send({ reason: 'BUDGET_NOT_SUITABLE', comment: 'Too low' })
      .expect(200);
    expect(res.body.status).toBe('NOT_QUALIFIED');

    // NOT_QUALIFIED is terminal — every further transition rejected.
    const attempt = await request(app.getHttpServer())
      .post(`/leads/${id}/qualify`)
      .set('Authorization', bearer(LG))
      .send({})
      .expect(409);
    expect(attempt.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('supports agent reassignment via the same /assign endpoint', async () => {
    const { body: created } = await createLead();
    const id = created.id;
    await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
    await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);

    // First assignment
    const first = await request(app.getHttpServer())
      .post(`/leads/${id}/assign`)
      .set('Authorization', bearer(ASUP))
      .send({ agentId: USERS.AGENT_A.id })
      .expect(200);
    expect(first.body.assignedAgentId).toBe(USERS.AGENT_A.id);

    // Reassignment
    const second = await request(app.getHttpServer())
      .post(`/leads/${id}/assign`)
      .set('Authorization', bearer(ASUP))
      .send({ agentId: USERS.AGENT_B.id })
      .expect(200);
    expect(second.body.assignedAgentId).toBe(USERS.AGENT_B.id);
    expect(second.body.status).toBe('AGENT_ASSIGNED');

    // AGENT_A can no longer convert (they're no longer assigned).
    const attempt = await request(app.getHttpServer())
      .post(`/leads/${id}/convert`)
      .set('Authorization', bearer(AA))
      .send({ propertyId: 1, unitId: 2 })
      .expect(403);
    expect(attempt.body.error.code).toBe('LEAD_NOT_ACCESSIBLE');
  });

  describe('invalid transitions', () => {
    it('qualify on NEW → 409 INVALID_TRANSITION', async () => {
      const { body } = await createLead();
      const res = await request(app.getHttpServer())
        .post(`/leads/${body.id}/qualify`)
        .set('Authorization', bearer(LG))
        .send({})
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(res.body.error.details).toEqual({ from: 'NEW', to: 'QUALIFIED' });
    });

    it('approve on AGENT_ASSIGNED → 409 INVALID_TRANSITION', async () => {
      const { body } = await createLead();
      const id = body.id;
      await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
      await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);
      await request(app.getHttpServer())
        .post(`/leads/${id}/assign`)
        .set('Authorization', bearer(ASUP))
        .send({ agentId: USERS.AGENT_A.id })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/leads/${id}/approve`)
        .set('Authorization', bearer(LGS))
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
    });

    it('convert by a non-assigned AGENT → 403 LEAD_NOT_ACCESSIBLE', async () => {
      const { body } = await createLead();
      const id = body.id;
      await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
      await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);
      await request(app.getHttpServer())
        .post(`/leads/${id}/assign`)
        .set('Authorization', bearer(ASUP))
        .send({ agentId: USERS.AGENT_A.id })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/leads/${id}/convert`)
        .set('Authorization', bearer(AB)) // AGENT_B, not the assignee
        .send({ propertyId: 1, unitId: 2 })
        .expect(403);
      expect(res.body.error.code).toBe('LEAD_NOT_ACCESSIBLE');
    });

    it('assign to a non-AGENT user → 400 INVALID_AGENT', async () => {
      const { body } = await createLead();
      const id = body.id;
      await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
      await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);

      // Try to assign to the LEAD_GENERATION user — not an AGENT.
      const res = await request(app.getHttpServer())
        .post(`/leads/${id}/assign`)
        .set('Authorization', bearer(ASUP))
        .send({ agentId: USERS.LEAD_GENERATION.id })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_AGENT');
    });

    it('assign to a nonexistent agentId → 400 INVALID_AGENT', async () => {
      const { body } = await createLead();
      const id = body.id;
      await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
      await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);

      const res = await request(app.getHttpServer())
        .post(`/leads/${id}/assign`)
        .set('Authorization', bearer(ASUP))
        .send({ agentId: 9999 })
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_AGENT');
    });
  });
});
