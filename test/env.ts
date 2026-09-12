// Runs in every Jest worker before any test file loads, so PrismaClient reads
// the correct DATABASE_URL when AppModule is later imported. Loads .env first
// (Nest ConfigModule hasn't run yet), then rewrites DATABASE_URL to the test DB.

import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) loadEnv({ path: envPath });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is required for e2e tests.\n' +
      'Add it to .env, e.g. TEST_DATABASE_URL=postgresql://aredc:aredc@localhost:5433/aredc_test?schema=public',
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// ConfigModule reads this too — supply a stable value so JWT signing is deterministic.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'e2e-test-secret';
