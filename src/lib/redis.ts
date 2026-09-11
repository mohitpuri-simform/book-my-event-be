import Redis from "ioredis";
import { env } from "../config/env";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

// Atomically increments a counter and sets its expiry only on the first hit.
// Doing this in a single Lua script (instead of separate INCR + EXPIRE calls)
// avoids a race where a crash between the two commands leaves the key with
// no TTL, permanently locking out whoever the key identifies.
const INCR_WITH_EXPIRE_LUA = `
local current = redis.call("INCR", KEYS[1])
if tonumber(current) == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  client.defineCommand("incrWithExpire", {
    numberOfKeys: 1,
    lua: INCR_WITH_EXPIRE_LUA,
  });
  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

interface RedisWithIncrWithExpire {
  incrWithExpire(key: string, windowSeconds: number): Promise<number>;
}

export async function incrWithExpire(key: string, windowSeconds: number): Promise<number> {
  const count = await (redis as unknown as RedisWithIncrWithExpire).incrWithExpire(
    key,
    windowSeconds,
  );
  return Number(count);
}
