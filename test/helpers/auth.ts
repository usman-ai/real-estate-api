import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * IDs are stable because the seed script creates users in this order and Postgres
 * assigns identity values sequentially. If the seed order ever changes, update here.
 */
export const USERS = {
  LEAD_GENERATION:            { id: 1, email: 'leadgen@aredc.test' },
  LEAD_GENERATION_SUPERVISOR: { id: 2, email: 'leadgen-supervisor@aredc.test' },
  AGENT_SUPERVISOR:           { id: 3, email: 'agent-supervisor@aredc.test' },
  AGENT_A:                    { id: 4, email: 'agent-a@aredc.test' },
  AGENT_B:                    { id: 5, email: 'agent-b@aredc.test' },
} as const;

export type UserKey = keyof typeof USERS;

const SEED_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Passw0rd!';

export async function login(app: INestApplication, key: UserKey): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: USERS[key].email, password: SEED_PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}

/** Bearer-header helper — `authHeader(token)` → `Bearer eyJ...`. */
export const bearer = (token: string) => `Bearer ${token}`;
