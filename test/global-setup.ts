// Runs once before the entire e2e suite: applies migrations to the test DB
// and seeds the fixed 5 users. Individual specs still truncate Lead+LeadEvent
// between tests but reuse the users (their IDs are asserted in helpers/auth.ts).

import { execSync } from 'child_process';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

export default async function globalSetup(): Promise<void> {
  const envPath = resolve(__dirname, '..', '.env');
  if (existsSync(envPath)) loadEnv({ path: envPath });

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required for e2e tests. Add it to .env, e.g. ' +
        'postgresql://aredc:aredc@localhost:5433/aredc_test?schema=public',
    );
  }

  const env = { ...process.env, DATABASE_URL: testUrl };
  // eslint-disable-next-line no-console
  console.log('\n[e2e] Applying migrations to test DB...');
  execSync('npx prisma migrate deploy', { env, stdio: 'inherit' });
  // eslint-disable-next-line no-console
  console.log('[e2e] Seeding users...');
  execSync('npx prisma db seed', { env, stdio: 'inherit' });
}
