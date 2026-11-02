import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['tests/**/*.test.ts'],env:{DATABASE_URL:'postgresql://test:test@localhost:5432/test',REDIS_URL:'redis://localhost:6379',S3_ENDPOINT:'http://localhost:9000',S3_ACCESS_KEY:'test-key',S3_SECRET_KEY:'test-secret'},fileParallelism:false}});
