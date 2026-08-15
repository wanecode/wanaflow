import { getPool } from "@wanaflow/db";
import { betterAuth } from "better-auth";

const developmentSecret = "wanaflow-development-secret-change-before-production";

function getBaseUrl() {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
}

function getSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required in production.");
  }
  return developmentSecret;
}

export const auth = betterAuth({
  appName: "Wanaflow",
  baseURL: getBaseUrl(),
  secret: getSecret(),
  database: getPool(),
  trustedOrigins: [getBaseUrl()],
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.WANAFLOW_BOOTSTRAP_MODE !== "true",
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: false,
  },
  session: {
    expiresIn: 60 * 60 * 12,
    disableSessionRefresh: true,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": {
        window: 60,
        max: Math.max(1, Number(process.env.WANAFLOW_AUTH_SIGN_IN_RATE_LIMIT ?? 5)),
      },
    },
  },
  advanced: {
    cookiePrefix: "wanaflow",
    database: {
      generateId: "uuid",
    },
  },
});

export type WanaflowSession = typeof auth.$Infer.Session;
