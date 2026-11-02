// Execute via: kubectl exec -i deployment/api -- node --input-type=module - < this file.
// Copy generated demo fixture to /tmp/cloudframe-demo.png and sign for internal MinIO DNS first.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base='http://localhost:3000/api/v1';
const count=Number(process.env.DEMO_JOBS||24);
assert(Number.isInteger(count)&&count>=1&&count<=60,'DEMO_JOBS must be 1–60');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function call(path,body){const response=await fetch(`${base}${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();assert(response.ok,JSON.stringify(data));return data;}
const body=new FormData();body.append('images',new Blob([await readFile('/tmp/cloudframe-demo.png')],{type:'image/png'}),'kubernetes-generated-demo.png');
const response=await fetch(`${base}/images/upload`,{method:'POST',body});assert(response.ok);const {uploads}=await response.json();
const ids=new Set();for(let index=0;index<count;index++){const accepted=await call('/jobs',{uploadIds:[uploads[0].id],transformations:{width:4800,format:'webp',quality:99,watermark:'KUBERNETES / GENERATED LOAD DEMO'}});ids.add(accepted.jobs[0].id);}
console.log(JSON.stringify({event:'submitted',jobs:count,at:new Date().toISOString()}));
const deadline=Date.now()+300000;let peakWorkers=0,peakQueue=0,completed=[];
while(Date.now()<deadline){
  const [history,stats]=await Promise.all([call('/jobs?limit=100'),call('/dashboard/stats')]);
  const jobs=history.jobs.filter(job=>ids.has(job.id));assert.equal(jobs.length,count);
  peakWorkers=Math.max(peakWorkers,stats.workers);peakQueue=Math.max(peakQueue,(stats.queue.wait||0)+(stats.queue.delayed||0));
  const done=jobs.filter(job=>job.status==='completed');const failed=jobs.filter(job=>job.status==='failed');
  console.log(JSON.stringify({event:'progress',at:new Date().toISOString(),completed:done.length,failed:failed.length,workers:stats.workers,queue:stats.queue.wait||0}));
  assert.equal(failed.length,0,'Real processing failures occurred');
  if(done.length===count){completed=done;break;}await sleep(5000);
}
assert.equal(completed.length,count,'Cluster demo exceeded five minutes');
const signed=await call(`/jobs/${completed[0].id}/download`);const result=await fetch(signed.url);assert(result.ok,'Internal presigned download failed');assert(result.headers.get('content-type')?.includes('image/webp'));
const metadata=completed[0].outputMetadata;assert.equal(metadata.width,4800);assert.equal(metadata.height,3000);
assert(peakWorkers>1,'The workload completed but real worker scaling was not observed');
console.log(JSON.stringify({event:'verified',at:new Date().toISOString(),completed:completed.length,peakWorkers,peakQueue,privateDownloadStatus:result.status,output:metadata}));
