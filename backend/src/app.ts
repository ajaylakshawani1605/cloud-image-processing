import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import swagger from 'swagger-ui-express';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { z } from 'zod';
import { PutObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { db, redis, queue, s3, signed, log } from './runtime.js';
import { config } from './config.js';
import { createJobs, listQuery } from './contracts.js';
import { openapi } from './openapi.js';
class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
const include={upload:true,audit:{orderBy:{createdAt:'asc' as const}}};
async function bounded<T>(operation:Promise<T>,milliseconds=6000):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Dependency timeout')),milliseconds);})]);}finally{clearTimeout(timer);}
}
const jobId=(req:express.Request)=>z.uuid().parse(req.params.id);
async function getJob(req:express.Request){const job=await db.job.findUnique({where:{id:jobId(req)},include});if(!job)throw new HttpError(404,'Job not found');return job;}
async function serialize(job:any,previews=false){
  const {objectKey,...upload}=job.upload;
  const {outputKey,...rest}=job;
  return {...rest,upload,...(previews?{originalUrl:await signed(config.S3_ORIGINAL_BUCKET,objectKey),outputUrl:outputKey?await signed(config.S3_OUTPUT_BUCKET,outputKey):null}:{})};
}
export const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{res.locals.requestId=randomUUID();res.setHeader('X-Request-Id',res.locals.requestId);next();});
app.use(helmet({contentSecurityPolicy:false})); // Nginx adds the frontend CSP; Swagger needs inline scripts.
app.use(cors({origin:config.CORS_ORIGINS.split(','),methods:['GET','POST']}));
app.use(express.json({limit:'32kb'}));
app.get('/api/v1/health/live',(_req,res)=>res.json({status:'alive'}));
app.use('/api/v1',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:config.MAX_UPLOAD_MB*1024*1024,files:8,fields:0}});
let activeUploads=0;
const reserveUpload:express.RequestHandler=(_req,res,next)=>{
  if(activeUploads>=2){next(new HttpError(429,'Upload capacity is busy. Please try again shortly.'));return;}
  activeUploads++;let released=false;
  const release=()=>{if(!released){released=true;activeUploads--;}};
  res.once('finish',release);res.once('close',release);next();
};
app.post('/api/v1/images/upload',rateLimit({windowMs:60000,limit:20}),reserveUpload,upload.array('images',8),async(req,res)=>{
  const files=req.files as Express.Multer.File[];
  if(!files?.length)throw new HttpError(400,'Choose at least one JPEG, PNG or WebP image');
  const validated=[];
  for(const file of files){
    let meta;try{meta=await sharp(file.buffer,{limitInputPixels:config.MAX_IMAGE_PIXELS,failOn:'error'}).metadata();}catch{throw new HttpError(400,'Image cannot be decoded or exceeds the pixel limit');}
    const formats:Record<string,{mime:string;extensions:string[]}>= {jpeg:{mime:'image/jpeg',extensions:['.jpg','.jpeg']},png:{mime:'image/png',extensions:['.png']},webp:{mime:'image/webp',extensions:['.webp']}};
    const format=formats[meta.format||''];
    if(!format||file.mimetype!==format.mime||!format.extensions.includes(extname(file.originalname).toLowerCase()))throw new HttpError(400,'File signature, MIME type and extension must match JPEG, PNG or WebP');
    if(!meta.width||!meta.height||meta.width*meta.height>config.MAX_IMAGE_PIXELS||(meta.pages??1)>1)throw new HttpError(400,'Animated or oversized images are not supported');
    const id=randomUUID(),objectKey=`${id}/original${extname(file.originalname).toLowerCase()}`;
    validated.push({file,id,objectKey,width:meta.width,height:meta.height,mime:format.mime});
  }
  const stored:string[]=[];
  let result;
  try{
    for(const v of validated){await s3.send(new PutObjectCommand({Bucket:config.S3_ORIGINAL_BUCKET,Key:v.objectKey,Body:v.file.buffer,ContentType:v.mime}));stored.push(v.objectKey);}
    result=await db.$transaction(validated.map(v=>db.upload.create({data:{id:v.id,objectKey:v.objectKey,name:v.file.originalname.replace(/[\x00-\x1f/\\]/g,'_').slice(0,180),mime:v.mime,size:v.file.size,width:v.width,height:v.height}})));
  }catch(err){await Promise.allSettled(stored.map(Key=>s3.send(new DeleteObjectCommand({Bucket:config.S3_ORIGINAL_BUCKET,Key}))));throw err;}
  res.status(201).json({uploads:await Promise.all(result.map(async({objectKey,...v})=>({...v,previewUrl:await signed(config.S3_ORIGINAL_BUCKET,objectKey)})))});
});
app.post('/api/v1/jobs',async(req,res)=>{
  const data=createJobs.parse(req.body);const ids=[...new Set(data.uploadIds)];
  const uploads=await db.upload.findMany({where:{id:{in:ids},createdAt:{gte:new Date(Date.now()-(config.RETENTION_DAYS*86400-3600)*1000)}}});
  if(uploads.length!==ids.length)throw new HttpError(404,'One or more uploads are missing or expired');
  const jobs=await db.$transaction(ids.map(uploadId=>db.job.create({data:{uploadId,transformations:data.transformations,audit:{create:{type:'queued',message:'Accepted and persisted in transactional outbox'}}},include})));
  res.status(202).json({jobs:await Promise.all(jobs.map(j=>serialize(j)))});
});
app.get('/api/v1/jobs',async(req,res)=>{
  const q=listQuery.parse(req.query),where={...(q.status?{status:q.status}:{}),...(q.search?{OR:[{upload:{name:{contains:q.search,mode:'insensitive' as const}}},...(z.uuid().safeParse(q.search).success?[{id:q.search}]:[])]}:{})};
  const [jobs,total]=await db.$transaction([db.job.findMany({where,include,orderBy:{createdAt:q.sort==='newest'?'desc':'asc'},skip:(q.page-1)*q.limit,take:q.limit}),db.job.count({where})]);
  res.json({jobs:await Promise.all(jobs.map(j=>serialize(j))),total,page:q.page,pages:Math.ceil(total/q.limit)});
});
app.get('/api/v1/jobs/:id',async(req,res)=>res.json(await serialize(await getJob(req),true)));
app.get('/api/v1/jobs/:id/download',async(req,res)=>{const job=await getJob(req);if(job.status!=='completed'||!job.outputKey)throw new HttpError(409,'Result is not available');if(job.completedAt&&job.completedAt.getTime()<Date.now()-config.RETENTION_DAYS*86400000)throw new HttpError(410,'Result has expired');res.json({url:await signed(config.S3_OUTPUT_BUCKET,job.outputKey,true),expiresIn:300});});
app.post('/api/v1/jobs/:id/retry',async(req,res)=>{
  const id=jobId(req);
  const job=await db.$transaction(async tx=>{
    const changed=await tx.job.updateMany({where:{id,status:'failed'},data:{status:'queued',generation:{increment:1},progress:0,error:null,attemptCount:0,dispatchedAt:null,startedAt:null,completedAt:null}});
    if(!changed.count)throw new HttpError(409,'Only failed jobs can be retried');
    await tx.auditEvent.create({data:{jobId:id,type:'retry',message:'Manual retry requested'}});
    return tx.job.findUniqueOrThrow({where:{id},include});
  });res.status(202).json(await serialize(job));
});
app.post('/api/v1/jobs/:id/cancel',async(req,_res)=>{await getJob(req);throw new HttpError(409,'Cancellation is not supported once processing may be reserved');});
let streams=0;
app.get('/api/v1/jobs/:id/events',async(req,res)=>{
  await getJob(req);if(streams>=50)throw new HttpError(429,'Too many event streams; use polling');
  streams++;res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
  let running=false,closed=false;const end=()=>{if(closed)return;closed=true;clearInterval(timer);clearTimeout(timeout);streams--;res.end();};
  const send=async()=>{if(running||closed)return;running=true;try{const job=await getJob(req);const snapshot=await serialize(job);if(!closed&&!res.writableEnded)res.write(`event: job\ndata: ${JSON.stringify(snapshot)}\n\n`);if(['completed','failed'].includes(job.status))end();}catch{if(!closed&&!res.writableEnded)res.write('event: unavailable\ndata: {}\n\n');end();}finally{running=false;}};
  const timer=setInterval(()=>void send(),2000),timeout=setTimeout(end,120000);req.on('close',end);void send();
});
async function readiness(){
  const names=['database','redis','storage'] as const;
  const probes=await Promise.allSettled([bounded(Promise.resolve(db.$queryRaw`SELECT 1`),4000),bounded(redis.ping(),4000),bounded(s3.send(new HeadBucketCommand({Bucket:config.S3_ORIGINAL_BUCKET})),4000)]);
  return Object.fromEntries(names.map((name,i)=>[name,probes[i].status==='fulfilled'?'up':'down']));
}
app.get('/api/v1/health/ready',async(_req,res)=>{const services=await readiness();res.status(Object.values(services).every(v=>v==='up')?200:503).json({services});});
app.get('/api/v1/dashboard/stats',async(_req,res)=>{
  const [groups,aggregate,counts,activity,workers]=await Promise.all([db.job.groupBy({by:['status'],_count:true}),db.job.aggregate({where:{status:'completed'},_avg:{durationMs:true}}),queue.getJobCounts('wait','active','delayed','failed'),db.$queryRaw<Array<{day:string;completed:number;failed:number}>>`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, count(j.id) FILTER (WHERE j.status='completed')::int AS completed, count(j.id) FILTER (WHERE j.status='failed')::int AS failed FROM generate_series(date_trunc('day',NOW())-INTERVAL '6 days',date_trunc('day',NOW()),INTERVAL '1 day') d(day) LEFT JOIN "Job" j ON j."createdAt">=d.day AND j."createdAt"<d.day+INTERVAL '1 day' GROUP BY d.day ORDER BY d.day`,queue.getWorkers()]);
  const byStatus=Object.fromEntries(groups.map(g=>[g.status,g._count]));
  res.json({total:groups.reduce((n,g)=>n+g._count,0),byStatus,averageDurationMs:aggregate._avg.durationMs,queue:counts,workers:workers.length,activity,limits:{maxUploadMB:config.MAX_UPLOAD_MB,maxImagePixels:config.MAX_IMAGE_PIXELS,retentionDays:config.RETENTION_DAYS},timestamp:new Date().toISOString()});
});
app.get('/api/v1/metrics',async(_req,res)=>{
  const [counts,groups,durations]=await Promise.all([queue.getJobCounts('wait','active','delayed'),db.job.groupBy({by:['status'],_count:true}),db.$queryRaw<Array<{le:number;n:bigint;sum:number;total:bigint}>>`SELECT b.le, count(j."durationMs") FILTER (WHERE j."durationMs"<=b.le*1000) AS n, COALESCE(sum(j."durationMs")/1000.0,0)::float AS sum, count(j."durationMs") AS total FROM (VALUES (0.1),(0.5),(1),(2.5),(5),(10),(30),(60),(300)) b(le) LEFT JOIN "Job" j ON j.status='completed' GROUP BY b.le ORDER BY b.le`]);
  const count=(s:string)=>groups.find(g=>g.status===s)?._count??0;
  const lines=['# HELP processed_jobs_total Completed jobs persisted in PostgreSQL','# TYPE processed_jobs_total counter',`processed_jobs_total ${count('completed')}`,'# HELP failed_jobs_total Terminal failed jobs currently in dead letter state','# TYPE failed_jobs_total gauge',`failed_jobs_total ${count('failed')}`,'# TYPE queue_depth gauge',`queue_depth ${(counts.wait??0)+(counts.delayed??0)}`,'# TYPE active_jobs gauge',`active_jobs ${counts.active??0}`,'# HELP image_processing_duration_seconds End-to-end successful processing duration','# TYPE image_processing_duration_seconds histogram',...durations.map(d=>`image_processing_duration_seconds_bucket{le="${d.le}"} ${d.n}`),`image_processing_duration_seconds_bucket{le="+Inf"} ${durations[0]?.total??0}`,`image_processing_duration_seconds_sum ${durations[0]?.sum??0}`,`image_processing_duration_seconds_count ${durations[0]?.total??0}`];
  res.type('text/plain; version=0.0.4').send(lines.join('\n')+'\n');
});
app.get('/api/v1/openapi.json',(_req,res)=>res.json(openapi));
app.use('/api/v1/docs',swagger.serve,swagger.setup(openapi));
app.use((_req,_res,next)=>next(new HttpError(404,'Endpoint not found')));
app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(res.headersSent){res.end();return;}
  const status=err instanceof HttpError?err.status:err instanceof z.ZodError?400:err instanceof multer.MulterError?413:err.type==='entity.parse.failed'?400:503;
  const message=err instanceof z.ZodError?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):err instanceof multer.MulterError?'Upload exceeds file size or file count limit':status===503?'Service temporarily unavailable. Please try again.':err.type==='entity.parse.failed'?'Invalid JSON body':err.message;
  log.warn({requestId:res.locals.requestId,status,kind:err.name},'Request failed');res.status(status).json({error:{message,requestId:res.locals.requestId}});
});
