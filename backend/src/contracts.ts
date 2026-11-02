import { z } from 'zod';
export const transformations = z.object({
  width: z.number().int().min(1).max(8192).optional(), height: z.number().int().min(1).max(8192).optional(),
  preserveAspect: z.boolean().default(true), quality: z.number().int().min(1).max(100).default(82),
  format: z.enum(['jpeg','png','webp']).default('webp'), rotate: z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]).default(0),
  grayscale: z.boolean().default(false), thumbnail: z.boolean().default(false), watermark: z.string().trim().max(80).optional()
}).strict().refine(v => !v.width || !v.height || v.width*v.height <= 25000000, 'Output dimensions exceed pixel limit');
export const createJobs = z.object({uploadIds:z.array(z.uuid()).min(1).max(8),transformations}).strict();
export const listQuery = z.object({page:z.coerce.number().int().positive().default(1),limit:z.coerce.number().int().min(1).max(100).default(15),status:z.enum(['queued','processing','completed','failed','retrying']).optional(),search:z.string().max(100).default(''),sort:z.enum(['newest','oldest']).default('newest')});
