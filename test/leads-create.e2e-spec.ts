import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app';
import { resetLeads } from './helpers/db';
import { bearer, login } from './helpers/auth';
import { PrismaService } from '../src/prisma/prisma.service';

describe('POST /leads (e2e)', () => {
  let app: INestApplication;
  let LG: string;
  let AGENT: string;

  const baseLead = {
    name: 'Ahmed Ali',
    phone: '+97400000001',
    whatsappNumber: '+97400000001',
    email: 'ahmed@example.com',
    source: 'FACEBOOK',
    interestedLocation: 'West Bay',
    propertyType: 'APARTMENT',
    bedrooms: 2,
    budgetFrom: 6000,
    budgetTo: 8000,
    priority: 'HOT',
  };

  beforeAll(async () => {
    app = await createTestApp();
    LG = await login(app, 'LEAD_GENERATION');
    AGENT = await login(app, 'AGENT_A');
  });
  afterAll(async () => app.close());
  beforeEach(async () => resetLeads(app));

  it('creates a new lead (201)', async () => {
    const res = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', bearer(LG))
      .send(baseLead)
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(Number),
      name: baseLead.name,
      source: baseLead.source,
      status: 'NEW',
      createdByUserId: expect.any(Number),
    });
  });

  it('rejects unauthenticated (401)', async () => {
    await request(app.getHttpServer()).post('/leads').send(baseLead).expect(401);
  });

  it('rejects wrong role — AGENT (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', bearer(AGENT))
      .send(baseLead)
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects invalid body (400 VALIDATION_FAILED)', async () => {
    const res = await request(app.getHttpServer())
      .post('/leads')
      .set('Authorization', bearer(LG))
      .send({ name: '', phone: 'xx', source: 'BOGUS' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.validationErrors.length).toBeGreaterThan(0);
  });

  describe('duplicate detection', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/leads')
        .set('Authorization', bearer(LG))
        .send(baseLead)
        .expect(201);
    });

    it('flags a duplicate on phone (409)', async () => {
      const res = await request(app.getHttpServer())
        .post('/leads')
        .set('Authorization', bearer(LG))
        .send({ ...baseLead, email: undefined, whatsappNumber: undefined, name: 'Copy' })
        .expect(409);
      expect(res.body.error.code).toBe('POSSIBLE_DUPLICATE');
      expect(res.body.error.details.existingLeadIds).toEqual([1]);
    });

    it('flags a duplicate on email — case insensitive (409)', async () => {
      const res = await request(app.getHttpServer())
        .post('/leads')
        .set('Authorization', bearer(LG))
        .send({ ...baseLead, phone: '+97499999999', whatsappNumber: undefined, email: 'AHMED@EXAMPLE.COM' })
        .expect(409);
      expect(res.body.error.code).toBe('POSSIBLE_DUPLICATE');
      expect(res.body.error.details.existingLeadIds).toEqual([1]);
    });

    it('flags a duplicate on whatsapp (409)', async () => {
      const res = await request(app.getHttpServer())
        .post('/leads')
        .set('Authorization', bearer(LG))
        .send({ ...baseLead, phone: '+97488888888', email: undefined })
        .expect(409);
      expect(res.body.error.code).toBe('POSSIBLE_DUPLICATE');
    });

    it('creates when confirmDuplicate:true is passed (201) and records intent on the audit event', async () => {
      const res = await request(app.getHttpServer())
        .post('/leads')
        .set('Authorization', bearer(LG))
        .send({ ...baseLead, name: 'Same phone on purpose', confirmDuplicate: true })
        .expect(201);
      expect(res.body.id).toBe(2);

      const prisma = app.get(PrismaService);
      const events = await prisma.leadEvent.findMany({
        where: { leadId: 2, type: 'LEAD_CREATED' },
      });
      expect(events).toHaveLength(1);
      expect(events[0].metadata).toEqual({
        duplicateOfIds: [1],
        createdWithConfirmDuplicate: true,
      });
    });
  });

  describe('source immutability', () => {
    it('never mutates source after creation (no endpoint accepts it in update DTOs)', async () => {
      const created = await request(app.getHttpServer())
        .post('/leads')
        .set('Authorization', bearer(LG))
        .send({ ...baseLead, source: 'MANUAL_ENTRY' })
        .expect(201);
      const id = created.body.id;

      // Attempt to sneak `source` through the qualify DTO — whitelist strips it.
      await request(app.getHttpServer()).post(`/leads/${id}/pickup`).set('Authorization', bearer(LG)).expect(200);
      const qualifyRes = await request(app.getHttpServer())
        .post(`/leads/${id}/qualify`)
        .set('Authorization', bearer(LG))
        .send({ source: 'FACEBOOK', qualificationComment: 'try to change source' });
      // Either 200 (source silently stripped) or 400 forbidNonWhitelisted — both prove immutability.
      expect([200, 400]).toContain(qualifyRes.status);

      const prisma = app.get(PrismaService);
      const after = await prisma.lead.findUnique({ where: { id } });
      expect(after?.source).toBe('MANUAL_ENTRY');
    });
  });
});
