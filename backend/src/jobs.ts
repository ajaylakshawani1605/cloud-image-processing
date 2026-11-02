import { db, queue, queueId, log } from './runtime.js';
import { config } from './config.js';
// The Job row is the transactional outbox. A deterministic queue ID closes the add/commit crash window.
export async function reconcile() {
  // Page every outstanding row; a large old backlog must not starve newly accepted jobs.
  let cursor:string|undefined;
  for(;;){
  const rows = await db.job.findMany({where:{status:{in:['queued','retrying','processing']}},orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{})});
  for(const row of rows) {
    const id=queueId(row.id,row.generation);
    const existing=await queue.getJob(id);
    if(!existing) {
      await queue.add('transform',{id:row.id,generation:row.generation},{jobId:id,attempts:config.JOB_ATTEMPTS,backoff:{type:'exponential',delay:2000},removeOnComplete:{age:86400,count:1000},removeOnFail:false});
      await db.job.updateMany({where:{id:row.id,generation:row.generation,dispatchedAt:null},data:{dispatchedAt:new Date()}});
    } else if(await existing.getState()==='failed') {
      await db.$transaction(async tx=>{
        const changed=await tx.job.updateMany({where:{id:row.id,generation:row.generation,status:{in:['queued','retrying','processing']}},data:{status:'failed',error:'Processing exhausted its retries. Retry the job to recover.',completedAt:new Date()}});
        if(changed.count) await tx.auditEvent.create({data:{jobId:row.id,type:'failed',message:'Dead letter: queue retries exhausted or worker repeatedly stalled'}});
      });
    }
  }
  if(rows.length<100)break;
  cursor=rows[rows.length-1].id;
  }
}
export function startReconciler() {
  let busy=false;
  const tick=async()=>{if(busy)return;busy=true;try{await reconcile();}catch{log.warn('Outbox reconciliation delayed; dependencies unavailable');}finally{busy=false;}};
  void tick(); const timer=setInterval(tick,5000);timer.unref();return ()=>clearInterval(timer);
}
