import app from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { holdExpiryWorker } from "./workers/holdExpiry.worker";
import { mailWorker } from "./workers/mail.worker";

const server = app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});

// Render sends SIGTERM on every deploy: stop accepting requests, let running
// jobs finish, then close connections. Force-exit before Render's SIGKILL.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const forceExit = setTimeout(() => process.exit(1), 25_000);
  forceExit.unref();
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all([mailWorker.close(), holdExpiryWorker.close()]);
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
