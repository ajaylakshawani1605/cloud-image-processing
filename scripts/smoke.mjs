import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
const base=process.env.API_URL||'http://localhost:3000/api/v1';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(path,options={},expected=200){const response=await fetch(`${base}${path}`,options);const body=await response.json();assert.equal(response.status,expected,`${path}: ${JSON.stringify(body)}`);return body;}
const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function upload(name,data,mime){const body=new FormData();body.append('images',new Blob([data],{type:mime}),name);return (await call('/images/upload',{method:'POST',body},201)).uploads[0];}
async function terminal(id){const deadline=Date.now()+120000;while(Date.now()<deadline){const row=await call(`/jobs/${id}`);if(['completed','failed'].includes(row.status))return row;await sleep(1000);}throw Error(`Job ${id} did not reach terminal state`);}
const ready=await call('/health/ready');assert(Object.values(ready.services).every(v=>v==='up'));
const uploads=[];for(const [ext,mime] of [['png','image/png'],['jpeg','image/jpeg'],['webp','image/webp']]){uploads.push(await upload(`demo-landscape.${ext}`,await readFile(new URL(`../tests/fixtures/demo-landscape.${ext}`,import.meta.url)),mime));}
const privateUrl=new URL(uploads[0].previewUrl);privateUrl.search='';assert.equal((await fetch(privateUrl)).status,403,'Original bucket must remain private');
const {jobs}=await call('/jobs',json({uploadIds:uploads.map(v=>v.id),transformations:{width:320,height:200,rotate:90,grayscale:true,watermark:'LIVE SMOKE / DEMO',format:'webp',quality:80}}),202);
const completed=[];
for(const job of jobs){const row=await terminal(job.id);assert.equal(row.status,'completed',row.error||'Processing failed');assert.equal(row.progress,100);const download=await call(`/jobs/${job.id}/download`);assert.equal(download.expiresIn,300);const result=await fetch(download.url);assert(result.ok,'Signed result must be downloadable');const data=Buffer.from(await result.arrayBuffer());const metadata=await sharp(data).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,125);assert.equal(metadata.height,200);assert.equal(row.outputMetadata.size,data.length);completed.push({id:job.id,source:row.upload.mime,size:data.length,width:metadata.width,height:metadata.height,durationMs:row.durationMs});}
await call(`/jobs/${jobs[0].id}/retry`,{method:'POST'},409);
await call(`/jobs/${jobs[0].id}/cancel`,{method:'POST'},409);
const events=await fetch(`${base}/jobs/${jobs[0].id}/events`);assert(events.ok);assert((await events.text()).includes('event: job'));
let recovery;
if(process.env.SMOKE_FAILURES==='1'){
  const original=await readFile(new URL('../tests/fixtures/demo-landscape.png',import.meta.url));
  const input=await upload('demo-failure-recovery.png',original,'image/png');
  const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}});
  const put=Body=>s3.send(new PutObjectCommand({Bucket:process.env.S3_ORIGINAL_BUCKET||'originals',Key:`${input.id}/original.png`,Body,ContentType:'image/png'}));
  try{
    await put(Buffer.from('deliberately corrupt demo fixture'));
    const accepted=await call('/jobs',json({uploadIds:[input.id],transformations:{format:'png'}}),202);
    const failed=await terminal(accepted.jobs[0].id);assert.equal(failed.status,'failed');assert.equal(failed.attemptCount,1,'Permanent failures must not consume automatic retries');
    await put(original);
    const retried=await call(`/jobs/${failed.id}/retry`,{method:'POST'},202);assert.equal(retried.generation,1);
    const restored=await terminal(failed.id);assert.equal(restored.status,'completed',restored.error||'Recovery failed');
    recovery={id:failed.id,permanentFailure:failed.error,attemptsBeforeManualRetry:failed.attemptCount,finalStatus:restored.status,generation:restored.generation};
  }finally{await put(original);s3.destroy();}
}
const metrics=await fetch(`${base}/metrics`);assert(metrics.ok);const exposition=await metrics.text();for(const name of ['processed_jobs_total','failed_jobs_total','image_processing_duration_seconds_bucket','queue_depth','active_jobs'])assert(exposition.includes(name));
const stats=await call('/dashboard/stats');assert(stats.total>=jobs.length);assert(stats.workers>=1);
const report={at:new Date().toISOString(),checks:['ready dependencies','three actual input encodings','private original access denied','HTTP 202 jobs','real Pillow resize/rotate/grayscale/watermark/WebP','signed private downloads','invalid retry/cancel gating','SSE terminal snapshot','real metrics'],completed,recovery,stats};
await mkdir(new URL('../.local/',import.meta.url),{recursive:true});await writeFile(new URL('../.local/smoke-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
