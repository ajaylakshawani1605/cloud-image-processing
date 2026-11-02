import { Worker, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { config } from '../../backend/src/config.js';
import { db, redis, log, queue } from '../../backend/src/runtime.js';
type Result={ok:boolean;permanent?:boolean;error?:string;metadata?:{width:number;height:number;size:number;format:string;mime:string}};
function processImage(payload:object):Promise<Result>{
  return new Promise((resolveResult,reject)=>{
    const child=spawn(config.PYTHON_BIN,[resolve('worker/runner.py')],{stdio:['pipe','pipe','pipe'],shell:false,env:process.env});
    let stdout='',stderr='',timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},config.PROCESS_TIMEOUT_MS);
    child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>16384)child.kill('SIGKILL');});
    child.stderr.on('data',chunk=>{if(stderr.length<4096)stderr+=chunk.toString();});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Python processor could not start'));});
    child.on('close',code=>{clearTimeout(timer);if(timedOut)return reject(new Error('Image processing timed out'));if(code!==0)return reject(new Error('Image processor exited unexpectedly'));try{resolveResult(JSON.parse(stdout));}catch{reject(new Error('Invalid processor response'));}});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
  });
}
await db.$connect();
const workerConnection=new Redis(config.REDIS_URL,{maxRetriesPerRequest:null});
workerConnection.on('error',()=>log.warn('Worker Redis connection unavailable'));
const worker=new Worker('images',async job=>{
  const {id,generation}=job.data as {id:string;generation:number};
  let row=await db.job.findUniqueOrThrow({where:{id},include:{upload:true}});
  if(row.generation!==generation||['completed','failed','cancelled'].includes(row.status))return {duplicate:true};
  const started=Date.now();
  const changed=await db.job.updateMany({where:{id,generation,status:{in:['queued','retrying','processing']}},data:{status:'processing',progress:10,attemptCount:{increment:1},startedAt:new Date(),error:null}});
  if(!changed.count)return {duplicate:true};
  await db.auditEvent.create({data:{jobId:id,type:'processing',message:`Processing delivery ${job.attemptsMade+1}`}});
  await job.updateProgress(10);
  log.info({jobId:id,generation,attempt:job.attemptsMade+1},'Processing image');
  try{
    const settings=row.transformations as Record<string,unknown>;
    const outputKey=`${id}/g${generation}.${settings.format}`;
    const result=await processImage({originalKey:row.upload.objectKey,outputKey,transformations:settings});
    if(!result.ok){if(result.permanent)throw new UnrecoverableError(result.error||'Image cannot be processed');throw new Error(result.error||'Processing failed');}
    if(!result.metadata)throw new Error('Image processor returned no metadata');
    // Output PUT has completed before PostgreSQL completion and before BullMQ acknowledges.
    await db.$transaction(async tx=>{
      const completed=await tx.job.updateMany({where:{id,generation,status:'processing'},data:{status:'completed',progress:100,outputKey,outputMetadata:result.metadata,durationMs:Date.now()-started,completedAt:new Date(),error:null}});
      if(completed.count)await tx.auditEvent.create({data:{jobId:id,type:'completed',message:'Private output stored and completion committed'}});
    });
    log.info({jobId:id,durationMs:Date.now()-started},'Processing completed');return {outputKey};
  }catch(err){
    const permanent=err instanceof UnrecoverableError;
    const terminal=permanent||job.attemptsMade+1>=(job.opts.attempts??1);
    const safeErrors=new Set(['Image processing timed out','Python processor could not start','Image processor exited unexpectedly','Invalid processor response','Processing service temporarily unavailable','Storage temporarily unavailable']);
    const message=err instanceof UnrecoverableError?err.message:err instanceof Error&&safeErrors.has(err.message)?err.message:'Processing temporarily unavailable';
    // A commit may have succeeded even if its response was lost; never overwrite completed state.
    await db.$transaction(async tx=>{
      const failed=await tx.job.updateMany({where:{id,generation,status:{not:'completed'}},data:{status:terminal?'failed':'retrying',error:message,progress:0,...(terminal?{completedAt:new Date()}:{} )}});
      if(failed.count)await tx.auditEvent.create({data:{jobId:id,type:terminal?'failed':'retrying',message:terminal?message:'Transient failure; exponential retry scheduled'}});
    });
    log.warn({jobId:id,terminal},'Processing attempt failed');throw err;
  }
},{connection:workerConnection,concurrency:config.WORKER_CONCURRENCY,lockDuration:90000,stalledInterval:30000,maxStalledCount:2});
worker.on('error',()=>log.warn('BullMQ worker connection error'));
worker.on('failed',(job)=>log.warn({jobId:job?.data.id},'BullMQ delivery failed'));
let shuttingDown=false;
const health=createServer(async(req,res)=>{
  if(req.url==='/health/live'){res.end('alive');return;}
  if(req.url!=='/health/ready'){res.writeHead(404).end();return;}
  try{if(shuttingDown||!worker.isRunning())throw Error();await Promise.all([redis.ping(),db.$queryRaw`SELECT 1`]);res.end('ready');}catch{res.writeHead(503).end('unavailable');}
}).listen(3001);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  shuttingDown=true;health.close();void worker.close().then(async()=>{await workerConnection.quit();await queue.close();await redis.quit();await db.$disconnect();process.exit(0);});setTimeout(()=>process.exit(1),config.PROCESS_TIMEOUT_MS+15000).unref();
});
log.info({concurrency:config.WORKER_CONCURRENCY},'BullMQ/Python worker ready');
