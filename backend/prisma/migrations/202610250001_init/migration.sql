CREATE TABLE "Upload" ("id" UUID PRIMARY KEY, "objectKey" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "mime" TEXT NOT NULL, "size" INTEGER NOT NULL, "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "Job" ("id" UUID PRIMARY KEY, "uploadId" UUID NOT NULL REFERENCES "Upload"("id"), "transformations" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued', "progress" INTEGER NOT NULL DEFAULT 0, "generation" INTEGER NOT NULL DEFAULT 0, "attemptCount" INTEGER NOT NULL DEFAULT 0, "dispatchedAt" TIMESTAMP(3), "outputKey" TEXT, "outputMetadata" JSONB, "error" TEXT, "durationMs" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3));
CREATE TABLE "AuditEvent" ("id" UUID PRIMARY KEY, "jobId" UUID NOT NULL REFERENCES "Job"("id") ON DELETE CASCADE, "type" TEXT NOT NULL, "message" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "Upload_createdAt_idx" ON "Upload"("createdAt");
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");
CREATE INDEX "Job_dispatchedAt_idx" ON "Job"("dispatchedAt");
CREATE INDEX "AuditEvent_jobId_createdAt_idx" ON "AuditEvent"("jobId", "createdAt");
