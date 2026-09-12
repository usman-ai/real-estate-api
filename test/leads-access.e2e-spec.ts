import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app';
import { resetLeads } from './helpers/db';
import { USERS, bearer, login } from './helpers/auth';

describe('Access + role matrix (e2e)', () => {
  let app: INestApplication;
  let LG: string, LGS: string, ASUP: string, AA: string, AB: string;
  let leadForA: number;
  let leadForB: number;
  let unassignedNew: number;

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

  beforeEach(async () => {
    await resetLeads(app);

    const drive = async (name: string, phone: string, assignTo?: number) => {
      const { body } = await request(app.getHttpServer())
        .post('/leads')
        .set('Authorization', bearer(LG))
        .send({ name, phone, source: 'FACEBOOK' })
        .expect(201);
      const id = body.id;
      if (assignTo !== undefined) {
        await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
        await request(app.getHttpServer()).post(`/leads/${id}/qualify`).set('Authorization', bearer(LG)).send({}).expect(200);
        await request(app.getHttpServer())
          .post(`/leads/${id}/assign`)
          .set('Authorization', bearer(ASUP))
          .send({ agentId: assignTo })
          .expect(200);
      }
      return id;
    };
    leadForA = await drive('For A', '+97400000001', USERS.AGENT_A.id);
    leadForB = await drive('For B', '+97400000002', USERS.AGENT_B.id);
    unassignedNew = await drive('Unassigned', '+97400000003');
  });

  describe('GET /leads visibility', () => {
    it('LG_SUPERVISOR sees all 3 leads', async () => {
      const res = await request(app.getHttpServer()).get('/leads').set('Authorization', bearer(LGS)).expect(200);
      expect(res.body.map((l: any) => l.id).sort()).toEqual([leadForA, leadForB, unassignedNew].sort());
    });

    it('AGENT_A sees only their assigned lead', async () => {
      const res = await request(app.getHttpServer()).get('/leads').set('Authorization', bearer(AA)).expect(200);
      expect(res.body.map((l: any) => l.id)).toEqual([leadForA]);
    });

    it('AGENT_B sees only their assigned lead', async () => {
      const res = await request(app.getHttpServer()).get('/leads').set('Authorization', bearer(AB)).expect(200);
      expect(res.body.map((l: any) => l.id)).toEqual([leadForB]);
    });

    it('AGENT_A ?assignedAgentId=<agent-b> yields [] (visibility AND filter — no leak)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/leads?assignedAgentId=${USERS.AGENT_B.id}`)
        .set('Authorization', bearer(AA))
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('AGENT_A ?status=AGENT_ASSIGNED returns their own lead', async () => {
      const res = await request(app.getHttpServer())
        .get('/leads?status=AGENT_ASSIGNED')
        .set('Authorization', bearer(AA))
        .expect(200);
      expect(res.body.map((l: any) => l.id)).toEqual([leadForA]);
    });
  });

  describe('GET /leads/:id visibility', () => {
    it('AGENT_A can GET their own lead (200)', async () => {
      await request(app.getHttpServer()).get(`/leads/${leadForA}`).set('Authorization', bearer(AA)).expect(200);
    });

    it("AGENT_A cannot GET AGENT_B's lead — 404 (not 403; no ID enumeration)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/leads/${leadForB}`)
        .set('Authorization', bearer(AA))
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('AGENT_A cannot GET an unassigned lead — 404', async () => {
      await request(app.getHttpServer())
        .get(`/leads/${unassignedNew}`)
        .set('Authorization', bearer(AA))
        .expect(404);
    });
  });

  describe('mutation role matrix', () => {
    it('LEAD_GENERATION cannot approve — 403 FORBIDDEN', async () => {
      // First push a lead to CONVERTED_PENDING_APPROVAL so approve is otherwise valid.
      await request(app.getHttpServer())
        .post(`/leads/${leadForA}/convert`)
        .set('Authorization', bearer(AA))
        .send({ propertyId: 1, unitId: 2 })
        .expect(200);
      const res = await request(app.getHttpServer())
        .post(`/leads/${leadForA}/approve`)
        .set('Authorization', bearer(LG))
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('AGENT_SUPERVISOR cannot qualify — 403 FORBIDDEN', async () => {
      const res = await request(app.getHttpServer())
        .post(`/leads/${unassignedNew}/qualify`)
        .set('Authorization', bearer(ASUP))
        .send({})
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('AGENT cannot pickup — 403 FORBIDDEN', async () => {
      const res = await request(app.getHttpServer())
        .post(`/leads/${unassignedNew}/pickup`)
        .set('Authorization', bearer(AA))
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('AGENT_B cannot convert AGENT_A\'s lead — 403 LEAD_NOT_ACCESSIBLE', async () => {
      const res = await request(app.getHttpServer())
        .post(`/leads/${leadForA}/convert`)
        .set('Authorization', bearer(AB))
        .send({ propertyId: 1, unitId: 2 })
        .expect(403);
      expect(res.body.error.code).toBe('LEAD_NOT_ACCESSIBLE');
      expect(res.body.error.details).toEqual({ constraint: 'ASSIGNED_AGENT' });
    });
  });
});
