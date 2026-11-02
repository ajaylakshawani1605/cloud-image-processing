// Intentional fault injection in this project's local Compose stack only.
import 'dotenv/config';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const base=process.env.API_URL||'http://localhost:3000/api/v1';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function compose(...args){const result=spawnSync(process.platform==='win32'?'docker.exe':'docker',['compose',...args],{stdio:'inherit',shell:false});assert.equal(result.status,0,`docker compose ${args.join(' ')} failed`);}
async function call(path,body){const r=await fetch(`${base}${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});assert(r.ok,`${path} returned ${r.status}`);return r.json();}
async function waitFor(id,expected,timeout=180000,interval=3000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const row=await call(`/jobs/${id}`);if(row.status===expected)return row;if(row.status==='failed')throw Error(row.error);await sleep(interval);}throw Error(`Job did not become ${expected}`);}
const form=new FormData();form.append('images',new Blob([await readFile(new URL('../tests/fixtures/demo-landscape.png',import.meta.url))],{type:'image/png'}),'demo-resilience.png');
const response=await fetch(`${base}/images/upload`,{method:'POST',body:form});assert(response.ok);const {uploads}=await response.json();const uploadId=uploads[0].id;
const report={at:new Date().toISOString()};
let redisStopped=false;
try{
  compose('stop','redis');redisStopped=true;
  const accepted=await call('/jobs',{uploadIds:[uploadId],transformations:{width:640,format:'webp'}});
  const queued=await call(`/jobs/${accepted.jobs[0].id}`);assert.equal(queued.status,'queued');
  compose('start','redis');redisStopped=false;
  const recovered=await waitFor(queued.id,'completed');report.redisOutage={id:queued.id,acceptedWhileRedisStopped:true,finalStatus:recovered.status,attemptCount:recovered.attemptCount};
}finally{if(redisStopped)compose('start','redis');}
if(process.env.CRASH_WORKER==='1'){
  const accepted=await call('/jobs',{uploadIds:[uploadId],transformations:{width:6000,height:4000,preserveAspect:false,format:'webp',quality:99,watermark:'CRASH RECOVERY / GENERATED DEMO'}});
  const processing=await waitFor(accepted.jobs[0].id,'processing',15000,200);
  let workerStopped=false;
  try{
    compose('kill','--signal','SIGKILL','worker');workerStopped=true;
    compose('start','worker');workerStopped=false;
    const recovered=await waitFor(processing.id,'completed',200000,5000);assert(recovered.attemptCount>=2,'Expected an actual redelivery after the crash');
    report.workerCrash={id:processing.id,finalStatus:recovered.status,deliveries:recovered.attemptCount,durationMs:recovered.durationMs};
  }finally{if(workerStopped)compose('start','worker');}
}
await mkdir(new URL('../.local/',import.meta.url),{recursive:true});await writeFile(new URL('../.local/resilience-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
