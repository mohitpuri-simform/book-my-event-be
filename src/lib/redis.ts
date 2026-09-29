import Redis from "ioredis";
import { env } from "../config/env";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

// Deletes KEYS[1] only if its current value is JSON carrying the expected
// `holdId` (ARGV[1]). Used to release/expire a seat hold without racing a
// separate GET-then-DEL from Node, which could delete a different user's
// hold if the key was reused between the two calls.
const DELETE_IF_HOLD_MATCHES_LUA = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return 0
end
local ok, decoded = pcall(cjson.decode, raw)
if not ok or decoded.holdId ~= ARGV[1] then
  return 0
end
redis.call("DEL", KEYS[1])
return 1
`;

function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  client.defineCommand("deleteIfHoldMatches", {
    numberOfKeys: 1,
    lua: DELETE_IF_HOLD_MATCHES_LUA,
  });
  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}

interface RedisWithDeleteIfHoldMatches {
  deleteIfHoldMatches(key: string, holdId: string): Promise<number>;
}

/** Returns true if the key existed with the expected holdId and was deleted. */
export async function deleteIfHoldMatches(key: string, holdId: string): Promise<boolean> {
  const result = await (redis as unknown as RedisWithDeleteIfHoldMatches).deleteIfHoldMatches(
    key,
    holdId,
  );
  return result === 1;
}

/**
 * True when Redis is known to be unreachable right now, so a hold request
 * can fail closed immediately instead of hanging on a command that will
 * eventually reject anyway. `redis.status` is a cheap in-memory read, not a
 * round trip.
 */
export function isRedisDown(): boolean {
  return redis.status !== "ready";
}
