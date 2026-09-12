import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app';
import { resetLeads } from './helpers/db';
import { USERS, bearer, login } from './helpers/auth';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetLeads(app);
  });

  describe('POST /auth/login', () => {
    it.each(Object.keys(USERS))('logs in seeded user %s and returns a JWT', async (key) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: USERS[key as keyof typeof USERS].email, password: 'Passw0rd!' })
        .expect(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.accessToken.split('.')).toHaveLength(3);
    });

    it('returns 401 UNAUTHORIZED for wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: USERS.LEAD_GENERATION.email, password: 'WrongPass1' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns identical 401 for unknown email (no user enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@nowhere.test', password: 'Whatever1' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns 400 VALIDATION_FAILED for a bad email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email', password: 'Whatever1' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('protected routes', () => {
    it('rejects a request without a Bearer token with 401', async () => {
      const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('accepts a valid token and returns the current user', async () => {
      const token = await login(app, 'LEAD_GENERATION');
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', bearer(token))
        .expect(200);
      expect(res.body).toEqual({
        id: USERS.LEAD_GENERATION.id,
        email: USERS.LEAD_GENERATION.email,
        role: 'LEAD_GENERATION',
        name: expect.any(String),
      });
    });
  });
});
