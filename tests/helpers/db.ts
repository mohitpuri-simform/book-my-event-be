import { prisma } from "../../src/lib/prisma";
import { redis } from "../../src/lib/redis";

/**
 * Wipes every table this feature touches, in FK-safe order, plus the whole
 * Redis keyspace. Intended for a disposable dev/test instance (the
 * docker-compose one) between tests — never point this at anything else.
 */
export async function resetState(): Promise<void> {
  await prisma.booking.deleteMany();
  await prisma.paymentAttempt.deleteMany();
  await prisma.processedWebhookEvent.deleteMany();
  await prisma.hold.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.section.deleteMany();
  await prisma.event.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await redis.flushdb();
}

export async function disconnectAll(): Promise<void> {
  await prisma.$disconnect();
  await redis.quit();
}
