import { app } from './app.js';
import { config } from './config.js';
import { db, redis, queue, initStorage, log } from './runtime.js';
import { startReconciler } from './jobs.js';
await db.$connect();
await initStorage();
const stopReconciler=startReconciler();
const server=app.listen(config.PORT,()=>log.info({port:config.PORT},'API listening'));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  stopReconciler();server.close(()=>{void Promise.allSettled([queue.close(),redis.quit(),db.$disconnect()]).then(()=>process.exit(0));});setTimeout(()=>process.exit(1),10000).unref();
});
