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

type RedisEnvironment = {
  url: string;
  token: string;
  source: "upstash" | "vercel-kv";
};

function readPositiveLimit(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRestUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function resolveRedisEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): RedisEnvironment | null {
  const candidates: RedisEnvironment[] = [
    {
      url: nonEmpty(environment.UPSTASH_REDIS_REST_URL) ?? "",
      token: nonEmpty(environment.UPSTASH_REDIS_REST_TOKEN) ?? "",
      source: "upstash",
    },
    {
      url: nonEmpty(environment.KV_REST_API_URL) ?? "",
      token: nonEmpty(environment.KV_REST_API_TOKEN) ?? "",
      source: "vercel-kv",
    },
  ];

  return candidates.find(({ url, token }) => Boolean(token) && isRestUrl(url)) ?? null;
}

export function createRateLimitRedisClient(
  environment: NodeJS.ProcessEnv = process.env
) {
  const configuration = resolveRedisEnvironment(environment);
  const salt = nonEmpty(environment.RATE_LIMIT_HASH_SALT);

  if (!configuration || !salt) {
    console.error(
      "Rate limit unavailable: Redis environment configuration is missing."
    );
    throw new RateLimitUnavailableError();
  }

  return new Redis({
    url: configuration.url,
    token: configuration.token,
    retry: false,
  });
}

function getRedisClient() {
  return createRateLimitRedisClient();
}

function safeRedisError(error: unknown) {
  const details: { name: string; message?: string } = {
    name: error instanceof Error ? error.name : "UnknownError",
  };

  if (!(error instanceof Error) || !error.message) return details;

  const secretValues = [
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.KV_REST_API_URL,
    process.env.KV_REST_API_TOKEN,
    process.env.RATE_LIMIT_HASH_SALT,
  ].filter((value): value is string => Boolean(value));

  const containsSecret = secretValues.some((value) => error.message.includes(value));
  const containsConnectionData =
    /(?:https?|rediss?):\/\/|authorization|bearer\s|(?:\d{1,3}\.){3}\d{1,3}/i.test(
      error.message
    );

  if (!containsSecret && !containsConnectionData) details.message = error.message;
  return details;
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
  const salt = nonEmpty(process.env.RATE_LIMIT_HASH_SALT);
  if (!salt) {
    console.error(
      "Rate limit unavailable: Redis environment configuration is missing."
    );
    throw new RateLimitUnavailableError();
  }

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
      throw new TypeError("Redis rate limit command returned an invalid response.");
    }

    if (Number(result[0]) === 1) return { allowed: true };

    const scopes: RateLimitScope[] = ["burst", "visitor", "global"];
    const scope = scopes[Number(result[1]) - 1];
    if (!scope || !Number.isFinite(Number(result[2]))) {
      throw new TypeError("Redis rate limit command returned an invalid response.");
    }

    return {
      allowed: false,
      scope,
      retryAfter: Math.max(1, Math.ceil(Number(result[2]) / 1_000)),
    };
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) throw error;

    console.error(
      "Rate limit unavailable: Redis command failed.",
      safeRedisError(error)
    );
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
