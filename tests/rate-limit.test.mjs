import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  checkAiRateLimit,
  createRateLimitRedisClient,
  RateLimitUnavailableError,
  rateLimitUnavailableResponse,
  resolveRedisEnvironment,
} from "../app/api/lib/rate-limit.ts";

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

class AtomicRedisMock {
  counters = new Map();
  keys = [];
  now = 0;

  async eval(_script, keys, args) {
    this.keys.push(...keys);
    const limits = args.slice(0, 3).map(Number);
    const ttls = args.slice(3, 6).map(Number);

    for (let index = 0; index < keys.length; index += 1) {
      const entry = this.counters.get(keys[index]);
      if (entry && entry.expiresAt <= this.now) this.counters.delete(keys[index]);
      const current = this.counters.get(keys[index]);
      if ((current?.value ?? 0) >= limits[index]) {
        return [0, index + 1, Math.max(1, current.expiresAt - this.now)];
      }
    }

    for (let index = 0; index < keys.length; index += 1) {
      const current = this.counters.get(keys[index]);
      this.counters.set(keys[index], {
        value: (current?.value ?? 0) + 1,
        expiresAt: current?.expiresAt ?? this.now + ttls[index],
      });
    }

    return [1, 0, 0];
  }
}

function requestFor(ip) {
  return new Request("https://example.test/api/ask", {
    headers: { "x-vercel-forwarded-for": ip },
  });
}

async function check(redis, ip, now) {
  redis.now = now;
  return checkAiRateLimit(requestFor(ip), redis, now);
}

test("prefers Vercel's writable KV credentials and supports Upstash aliases", () => {
  const both = resolveRedisEnvironment({
    KV_REST_API_URL: "https://native.example",
    KV_REST_API_TOKEN: "native-write-token",
    UPSTASH_REDIS_REST_URL: "https://manual.example",
    UPSTASH_REDIS_REST_TOKEN: "manual-token",
  });
  const aliases = resolveRedisEnvironment({
    UPSTASH_REDIS_REST_URL: "https://manual.example",
    UPSTASH_REDIS_REST_TOKEN: "manual-token",
  });

  assert.equal(both?.source, "vercel-kv");
  assert.equal(aliases?.source, "upstash");
});

test("the Upstash SDK sends writable EVAL with three keys and six arguments", async () => {
  let captured;
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    captured = {
      authorization: request.headers.authorization,
      path: request.url,
      command: JSON.parse(body)[0],
    };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify([{ result: [1, 0, 0] }]));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const redis = createRateLimitRedisClient({
      KV_REST_API_URL: `http://127.0.0.1:${address.port}`,
      KV_REST_API_TOKEN: "writable-test-token",
      RATE_LIMIT_HASH_SALT: "test-salt",
    });
    process.env.RATE_LIMIT_HASH_SALT = "test-salt";
    assert.deepEqual(
      await checkAiRateLimit(requestFor("203.0.113.9"), redis, 1_700_000_000_000),
      { allowed: true }
    );
  } finally {
    server.close();
  }

  assert.equal(captured.path, "/pipeline");
  assert.equal(captured.authorization, "Bearer writable-test-token");
  assert.equal(captured.command[0].toLowerCase(), "eval");
  assert.equal(captured.command[2], 3);
  assert.equal(captured.command.slice(3, 6).length, 3);
  assert.equal(captured.command.slice(6).length, 6);
  assert.ok(captured.command.slice(6).every((value) => /^\d+$/.test(value)));
});

test("allows three operations and rejects the fourth in one minute", async () => {
  process.env.RATE_LIMIT_HASH_SALT = "test-salt";
  const redis = new AtomicRedisMock();
  const now = Date.UTC(2026, 0, 1, 12);

  for (let count = 0; count < 3; count += 1) {
    assert.deepEqual(await check(redis, "203.0.113.10", now), { allowed: true });
  }
  const denied = await check(redis, "203.0.113.10", now);
  assert.equal(denied.allowed, false);
  assert.equal(denied.scope, "burst");
  assert.ok(denied.retryAfter > 0);
});

test("enforces the visitor UTC daily limit without charging rejected scopes", async () => {
  process.env.RATE_LIMIT_HASH_SALT = "test-salt";
  const redis = new AtomicRedisMock();
  const start = Date.UTC(2026, 0, 1, 0, 0, 1);

  for (let count = 0; count < 10; count += 1) {
    assert.equal(
      (await check(redis, "203.0.113.11", start + count * 61_000)).allowed,
      true
    );
  }
  const denied = await check(redis, "203.0.113.11", start + 10 * 61_000);
  assert.equal(denied.allowed, false);
  assert.equal(denied.scope, "visitor");
});

test("visitors have independent quotas and share the global quota", async () => {
  process.env.RATE_LIMIT_HASH_SALT = "test-salt";
  process.env.AI_GLOBAL_DAILY_LIMIT = "2";
  const redis = new AtomicRedisMock();
  const now = Date.UTC(2026, 0, 1, 12);

  assert.equal((await check(redis, "203.0.113.12", now)).allowed, true);
  assert.equal((await check(redis, "203.0.113.13", now)).allowed, true);
  const denied = await check(redis, "203.0.113.14", now);
  assert.equal(denied.allowed, false);
  assert.equal(denied.scope, "global");
});

test("enforces the default global daily limit", async () => {
  process.env.RATE_LIMIT_HASH_SALT = "test-salt";
  const redis = new AtomicRedisMock();
  const now = Date.UTC(2026, 0, 1, 12);

  for (let count = 1; count <= 200; count += 1) {
    const thirdOctet = Math.floor((count - 1) / 254);
    const fourthOctet = ((count - 1) % 254) + 1;
    assert.equal(
      (await check(redis, `198.51.${thirdOctet}.${fourthOctet}`, now)).allowed,
      true
    );
  }
  const denied = await check(redis, "198.51.100.250", now);
  assert.equal(denied.allowed, false);
  assert.equal(denied.scope, "global");
});

test("backend errors fail closed without logging visitor identifiers", async () => {
  process.env.RATE_LIMIT_HASH_SALT = "test-salt";
  const rawIp = "203.0.113.99";
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logs.push(JSON.stringify(values));

  try {
    await assert.rejects(
      checkAiRateLimit(requestFor(rawIp), {
        eval: async () => {
          throw new Error("Command failed: NOPERM operation not permitted");
        },
      }),
      RateLimitUnavailableError
    );
  } finally {
    console.error = originalConsoleError;
  }

  const output = logs.join("\n");
  assert.doesNotMatch(output, new RegExp(rawIp.replaceAll(".", "\\.")));
  assert.doesNotMatch(output, /ask-my-docs:ai:/);
  assert.match(output, /permission_denied/);
  assert.equal(rateLimitUnavailableResponse().status, 503);
});

test("Redis keys contain only hashed visitor identities", async () => {
  process.env.RATE_LIMIT_HASH_SALT = "test-salt";
  const redis = new AtomicRedisMock();
  const rawIp = "203.0.113.25";
  await check(redis, rawIp, Date.UTC(2026, 0, 1, 12));

  assert.equal(redis.keys.length, 3);
  assert.ok(redis.keys.every((key) => !key.includes(rawIp)));
  assert.match(redis.keys[0], /^ask-my-docs:ai:burst:[a-f0-9]{64}:\d+$/);
});
