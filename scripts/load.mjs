import {readFile} from 'node:fs/promises';
const base=process.env.API_URL||'http://localhost:3000/api/v1';
const count=Number(process.env.JOBS||30);
if(!Number.isInteger(count)||count<1||count>200)throw new Error('JOBS must be 1–200');
const fixture=await readFile(new URL('../tests/fixtures/demo-landscape.png',import.meta.url));
const form=new FormData();form.append('images',new Blob([fixture],{type:'image/png'}),'demo-landscape.png');
const response=await fetch(`${base}/images/upload`,{method:'POST',body:form});if(!response.ok)throw new Error(`Upload failed: ${response.status}`);
const {uploads}=await response.json();const ids=[];
for(let n=0;n<count;n++){
  const result=await fetch(`${base}/jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadIds:[uploads[0].id],transformations:{width:2400,format:'webp',quality:95,watermark:'LOAD TEST / DEMO'}})});
  if(!result.ok)throw new Error(`Job acceptance failed: ${result.status}`);
  const {jobs}=await result.json();ids.push(jobs[0].id);
}
console.log(JSON.stringify({submitted:ids.length,jobIds:ids},null,2));
const wanted=new Set(ids);
async function snapshots(){
  const found=new Map();let page=1;
  while(found.size<ids.length){
    const response=await fetch(`${base}/jobs?limit=100&page=${page}`);if(!response.ok)throw new Error(`Polling failed ${response.status}`);
    const data=await response.json();for(const job of data.jobs)if(wanted.has(job.id))found.set(job.id,job);
    if(page>=data.pages)break;page++;
  }
  if(found.size!==ids.length)throw new Error('Some submitted jobs are missing from persistent history');
  return [...found.values()];
}
const deadline=Date.now()+300000;
while(Date.now()<deadline){const results=await snapshots();const counts=Object.fromEntries(['queued','processing','retrying','completed','failed'].map(s=>[s,results.filter(j=>j.status===s).length]));console.log(JSON.stringify({at:new Date().toISOString(),...counts}));if(counts.completed+counts.failed===count){process.exitCode=counts.failed?1:0;break;}await new Promise(r=>setTimeout(r,15000));}
if(Date.now()>=deadline)throw new Error('Load run exceeded 5-minute deadline');
