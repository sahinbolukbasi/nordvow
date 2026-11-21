import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client";
import { requireEnv } from "./env";

export * from "./generated/prisma/client";

/** prisma.$transaction içindeki istemci tipi (PrismaClient de bu tipe uyar). */
export type Tx = Prisma.TransactionClient;

function createClient(): PrismaClient {
  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// Tekil pg.Pool: hem dev hot-reload'da hem production standalone chunk'larında bağlantı sızıntısını önler.
const globalForPrisma = globalThis as unknown as { __infulancerPrisma?: PrismaClient; __infulancerShutdownBound?: boolean };

export const prisma: PrismaClient = globalForPrisma.__infulancerPrisma ?? createClient();
globalForPrisma.__infulancerPrisma = prisma;

if (!globalForPrisma.__infulancerShutdownBound) {
  globalForPrisma.__infulancerShutdownBound = true;
  process.once("SIGTERM", () => {
    void prisma.$disconnect().catch(() => undefined);
  });
}
