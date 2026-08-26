import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Redis } from "@upstash/redis";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const RATE_LIMIT_SCRIPT = `
for index = 1, 3 do
  local current = tonumber(redis.call("GET", KEYS[index]) or "0")
  if current >= tonumber(ARGV[index]) then
    local ttl = redis.call("PTTL", KEYS[index])
    if ttl < 0 then ttl = tonumber(ARGV[index + 3]) end
    return {0, index, ttl}
  end
end

for index = 1, 3 do
  local current = redis.call("INCR", KEYS[index])
  if current == 1 then
    redis.call("PEXPIRE", KEYS[index], ARGV[index + 3])
  end
end

return {1, 0, 0}
`;

type RateLimitScope = "burst" | "visitor" | "global";

export type AiRateLimitResult =
  | { allowed: true }
  | { allowed: false; scope: RateLimitScope; retryAfter: number };

export class RateLimitUnavailableError extends Error {
  constructor() {
    super("Rate limit backend unavailable");
    this.name = "RateLimitUnavailableError";
  }
}

type RedisEvalClient = Pick<Redis, "eval">;

function readPositiveLimit(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getRedisClient() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token || !process.env.RATE_LIMIT_HASH_SALT) {
    throw new RateLimitUnavailableError();
  }

  return new Redis({ url, token, retry: false });
}

function normalizeClientIp(request: Request) {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  const candidate = forwarded.split(",")[0]?.trim().toLowerCase() ?? "";
  const withoutBrackets = candidate.replace(/^\[([^\]]+)\](?::\d+)?$/, "$1");
  const withoutIpv4Port = withoutBrackets.replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1");

  return isIP(withoutIpv4Port) ? withoutIpv4Port : "unknown";
}

function getVisitorHash(request: Request) {
  const salt = process.env.RATE_LIMIT_HASH_SALT;
  if (!salt) throw new RateLimitUnavailableError();

  return createHmac("sha256", salt)
    .update(normalizeClientIp(request))
    .digest("hex");
}

export async function checkAiRateLimit(
  request: Request,
  redis: RedisEvalClient = getRedisClient(),
  now = Date.now()
): Promise<AiRateLimitResult> {
  const visitorHash = getVisitorHash(request);
  const minuteBucket = Math.floor(now / MINUTE_MS);
  const dayBucket = Math.floor(now / DAY_MS);
  const minuteTtl = MINUTE_MS - (now % MINUTE_MS);
  const dayTtl = DAY_MS - (now % DAY_MS);
  const limits = [
    readPositiveLimit("AI_BURST_LIMIT", 3),
    readPositiveLimit("AI_DAILY_LIMIT_PER_VISITOR", 10),
    readPositiveLimit("AI_GLOBAL_DAILY_LIMIT", 200),
  ];

  try {
    const result = await redis.eval<string[], number[]>(
      RATE_LIMIT_SCRIPT,
      [
        `ask-my-docs:ai:burst:${visitorHash}:${minuteBucket}`,
        `ask-my-docs:ai:visitor:${visitorHash}:${dayBucket}`,
        `ask-my-docs:ai:global:${dayBucket}`,
      ],
      [
        ...limits.map(String),
        String(minuteTtl),
        String(dayTtl),
        String(dayTtl),
      ]
    );

    if (!Array.isArray(result) || result.length < 3) {
      throw new RateLimitUnavailableError();
    }

    if (Number(result[0]) === 1) return { allowed: true };

    const scopes: RateLimitScope[] = ["burst", "visitor", "global"];
    const scope = scopes[Number(result[1]) - 1];
    if (!scope) throw new RateLimitUnavailableError();

    return {
      allowed: false,
      scope,
      retryAfter: Math.max(1, Math.ceil(Number(result[2]) / 1_000)),
    };
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) throw error;

    console.error("AI rate limit backend failed:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    throw new RateLimitUnavailableError();
  }
}

export function rateLimitResponse(result: Exclude<AiRateLimitResult, { allowed: true }>) {
  const message =
    result.scope === "burst"
      ? "Çok hızlı işlem yapıyorsunuz. Lütfen kısa bir süre sonra tekrar deneyin."
      : result.scope === "visitor"
        ? "Günlük ücretsiz kullanım sınırına ulaştınız. Lütfen daha sonra tekrar deneyin."
        : "Demo günlük kullanım sınırına ulaştı. Lütfen daha sonra tekrar deneyin.";

  return Response.json(
    {
      ok: false,
      code: "RATE_LIMITED",
      message,
      retryAfter: result.retryAfter,
    },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfter) },
    }
  );
}

export function rateLimitUnavailableResponse() {
  return Response.json(
    {
      ok: false,
      code: "RATE_LIMIT_UNAVAILABLE",
      message: "AI işlemleri geçici olarak kullanılamıyor. Lütfen daha sonra tekrar deneyin.",
    },
    { status: 503 }
  );
}
