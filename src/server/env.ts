import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  FIELD_ENCRYPTION_KEY: z.string().min(40, "FIELD_ENCRYPTION_KEY 32 baytlık base64 olmalı"),
  BLIND_INDEX_KEY: z.string().min(40, "BLIND_INDEX_KEY 32 baytlık base64 olmalı"),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_MAX_HOURS: z.coerce.number().int().positive().default(12),
  DEFAULT_PHONE_COUNTRY: z.string().length(2).default("TR"),
});

export const env = schema.parse(process.env);
