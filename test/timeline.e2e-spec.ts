import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app';
import { resetLeads } from './helpers/db';
import { USERS, bearer, login } from './helpers/auth';

describe('Timeline (e2e)', () => {
  let app: INestApplication;
  let LG: string, LGS: string, ASUP: string, AA: string, AB: string;

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

  it('records every state change in order — full CONVERT path with reassignment', async () => {
    const { body: created } = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', bearer(LG))
      .send({ name: 'Ahmed', phone: '+97400000001', source: 'FACEBOOK' })
      .expect(201);
    const id = created.id;

    await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
    await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);
    await request(app.getHttpServer())
      .post(`/leads/${id}/assign`)
      .set('Authorization', bearer(ASUP))
      .send({ agentId: USERS.AGENT_B.id })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/leads/${id}/assign`)
      .set('Authorization', bearer(ASUP))
      .send({ agentId: USERS.AGENT_A.id })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/leads/${id}/convert`)
      .set('Authorization', bearer(AA))
      .send({ propertyId: 123, unitId: 456, comment: 'Agreed' })
      .expect(200);
    await request(app.getHttpServer()).post(`/leads/${id}/approve`).set('Authorization', bearer(LGS)).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/leads/${id}/timeline`)
      .set('Authorization', bearer(LGS))
      .expect(200);

    const types = res.body.map((e: any) => e.type);
    expect(types).toEqual([
      'LEAD_CREATED',
      'QUALIFICATION_STARTED',
      'LEAD_QUALIFIED',
      'PENDING_AGENT_ASSIGNMENT',
      'AGENT_ASSIGNED',
      'AGENT_REASSIGNED',
      'LEAD_MARKED_CONVERTED',
      'OUTCOME_APPROVED',
      'LEAD_CLOSED',
    ]);

    const byType = (t: string) => res.body.find((e: any) => e.type === t);
    expect(byType('AGENT_ASSIGNED').metadata).toEqual({ agentId: USERS.AGENT_B.id });
    expect(byType('AGENT_REASSIGNED').metadata).toEqual({
      agentId: USERS.AGENT_A.id,
      previousAgentId: USERS.AGENT_B.id,
    });
    expect(byType('LEAD_MARKED_CONVERTED').metadata).toEqual({ propertyId: 123, unitId: 456 });
    expect(byType('LEAD_MARKED_CONVERTED').comment).toBe('Agreed');
    expect(byType('OUTCOME_APPROVED').metadata).toEqual({ approvedOutcome: 'CONVERTED' });

    // Each event carries performer id, name and role — timeline reads as a story.
    for (const evt of res.body) {
      expect(evt.performedBy).toEqual({
        id: expect.any(Number),
        name: expect.any(String),
        role: expect.any(String),
      });
    }
  });

  it('records LEAD_MARKED_DROPPED + approvedOutcome=DROPPED for the drop path', async () => {
    const { body: created } = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', bearer(LG))
      .send({ name: 'F', phone: '+97400000002', source: 'WEBSITE' })
      .expect(201);
    const id = created.id;
    await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
    await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);
    await request(app.getHttpServer())
      .post(`/leads/${id}/assign`)
      .set('Authorization', bearer(ASUP))
      .send({ agentId: USERS.AGENT_A.id })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/leads/${id}/drop`)
      .set('Authorization', bearer(AA))
      .send({ reason: 'BUDGET_ISSUE', comment: 'Too low' })
      .expect(200);
    await request(app.getHttpServer()).post(`/leads/${id}/approve`).set('Authorization', bearer(LGS)).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/leads/${id}/timeline`)
      .set('Authorization', bearer(LGS))
      .expect(200);
    const types = res.body.map((e: any) => e.type);
    expect(types).toContain('LEAD_MARKED_DROPPED');
    expect(types).toContain('OUTCOME_APPROVED');
    const drop = res.body.find((e: any) => e.type === 'LEAD_MARKED_DROPPED');
    expect(drop.metadata).toEqual({ reason: 'BUDGET_ISSUE' });
    expect(drop.comment).toBe('Too low');
    const approved = res.body.find((e: any) => e.type === 'OUTCOME_APPROVED');
    expect(approved.metadata).toEqual({ approvedOutcome: 'DROPPED' });
  });

  it('retains timeline after LEAD_CLOSED', async () => {
    const { body: created } = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', bearer(LG))
      .send({ name: 'X', phone: '+97400000003', source: 'FACEBOOK' })
      .expect(201);
    const id = created.id;
    await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
    await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);
    await request(app.getHttpServer())
      .post(`/leads/${id}/assign`)
      .set('Authorization', bearer(ASUP))
      .send({ agentId: USERS.AGENT_A.id })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/leads/${id}/convert`)
      .set('Authorization', bearer(AA))
      .send({ propertyId: 1, unitId: 1 })
      .expect(200);
    await request(app.getHttpServer()).post(`/leads/${id}/approve`).set('Authorization', bearer(LGS)).expect(200);

    // The lead is now CLOSED — timeline still returns full history.
    const res = await request(app.getHttpServer())
      .get(`/leads/${id}/timeline`)
      .set('Authorization', bearer(LGS))
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(8);
    expect(res.body[res.body.length - 1].type).toBe('LEAD_CLOSED');
  });

  it('AGENT_A cannot read AGENT_B\'s timeline — 404', async () => {
    const { body: created } = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', bearer(LG))
      .send({ name: 'B lead', phone: '+97400000004', source: 'FACEBOOK' })
      .expect(201);
    const id = created.id;
    await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
    await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);
    await request(app.getHttpServer())
      .post(`/leads/${id}/assign`)
      .set('Authorization', bearer(ASUP))
      .send({ agentId: USERS.AGENT_B.id })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/leads/${id}/timeline`)
      .set('Authorization', bearer(AA))
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a missing lead', async () => {
    await request(app.getHttpServer())
      .get('/leads/9999/timeline')
      .set('Authorization', bearer(LGS))
      .expect(404);
  });
});
