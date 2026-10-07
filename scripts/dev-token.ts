/**
 * Signs an HS256 JWT accepted by reports-businesschat's JwtStrategy (local testing only).
 *
 *   JWT_SECRET=<reports JWT_SECRET> npm run dev:token -- [user_id] [email] [ttlHours]
 *
 * Reports must run with BYPASS_PERMISSIONS=true, otherwise the user's permissions are read from Redis.
 */
import { createHmac, randomUUID } from "node:crypto";

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error("JWT_SECRET is required (use the value from reports-businesschat/.env).");
  process.exit(1);
}

const [userId = "local-mcp-user", email = "mcp@local.test", ttlHours = "24"] = process.argv.slice(2);
const now = Math.floor(Date.now() / 1000);

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const payload = base64url(
  JSON.stringify({
    user_id: userId,
    email,
    type: "user",
    iat: now,
    exp: now + Number(ttlHours) * 3600,
    jti: randomUUID(),
  }),
);
const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");

process.stdout.write(`${header}.${payload}.${signature}\n`);
