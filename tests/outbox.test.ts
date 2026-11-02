import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({db:{job:{findMany:vi.fn(),updateMany:vi.fn()},$transaction:vi.fn()},queue:{getJob:vi.fn(),add:vi.fn()},log:{warn:vi.fn()}}));
vi.mock('../backend/src/runtime.js',()=>({...mock,queueId:(id:string,g:number)=>`${id}-g${g}`}));
import {reconcile} from '../backend/src/jobs.js';
beforeEach(()=>vi.clearAllMocks());
it('recovers an unpublished database job with a deterministic generation key',async()=>{
  mock.db.job.findMany.mockResolvedValue([{id:'job-id',generation:2,status:'queued'}]);mock.queue.getJob.mockResolvedValue(undefined);
  await reconcile();expect(mock.queue.add).toHaveBeenCalledWith('transform',{id:'job-id',generation:2},expect.objectContaining({jobId:'job-id-g2',attempts:3,removeOnFail:false}));expect(mock.db.job.updateMany).toHaveBeenCalledOnce();
});
it('does not republish an existing active delivery after an add/commit crash',async()=>{
  mock.db.job.findMany.mockResolvedValue([{id:'job-id',generation:0,status:'processing'}]);mock.queue.getJob.mockResolvedValue({getState:async()=>'active'});
  await reconcile();expect(mock.queue.add).not.toHaveBeenCalled();
});
