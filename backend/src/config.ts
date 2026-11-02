import 'dotenv/config';
import { z } from 'zod';
export const config = z.object({
  NODE_ENV: z.string().default('development'), PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1), REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(), S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'), S3_ACCESS_KEY: z.string().min(1), S3_SECRET_KEY: z.string().min(1),
  S3_ORIGINAL_BUCKET: z.string().default('originals'), S3_OUTPUT_BUCKET: z.string().default('processed'),
  CORS_ORIGINS: z.string().default('http://localhost:8080,http://localhost:5173'),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(25).default(10), MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(25000000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1), JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  PROCESS_TIMEOUT_MS: z.coerce.number().int().positive().max(300000).default(60000), RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7), PYTHON_BIN: z.string().default('python')
}).parse(process.env);
