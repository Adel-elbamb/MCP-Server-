import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3010),
  REPORTS_BASE_URL: z
    .string()
    .url()
    .default("http://localhost:3006/api/v1")
    .transform((url) => url.replace(/\/+$/, "")),
  REPORTS_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Local-testing fallbacks, used only when the MCP request does not carry these headers.
  REPORTS_TOKEN: optionalString,
  REPORTS_WORKSPACE_ID: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}
