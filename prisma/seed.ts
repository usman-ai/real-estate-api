import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Every seeded user shares the same password to make the assessment easy to
// smoke-test. Override via SEED_USER_PASSWORD if you want a different one.
const password = process.env.SEED_USER_PASSWORD ?? 'Passw0rd!';

interface SeedUser {
  email: string;
  name: string;
  role: Role;
}

const users: SeedUser[] = [
  { email: 'leadgen@aredc.test',            name: 'Layla Lead-Gen',        role: Role.LEAD_GENERATION },
  { email: 'leadgen-supervisor@aredc.test', name: 'Sami LG-Supervisor',    role: Role.LEAD_GENERATION_SUPERVISOR },
  { email: 'agent-supervisor@aredc.test',   name: 'Amira Agent-Supervisor',role: Role.AGENT_SUPERVISOR },
  { email: 'agent-a@aredc.test',            name: 'Ali Agent',             role: Role.AGENT },
  { email: 'agent-b@aredc.test',            name: 'Bilal Agent',           role: Role.AGENT },
];

async function main() {
  const passwordHash = await bcrypt.hash(password, 10);

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, passwordHash, isActive: true },
      create: { email: u.email, name: u.name, role: u.role, passwordHash, isActive: true },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded ${users.length} users (password: "${password}")`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
