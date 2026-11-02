import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import pino from 'pino';
import { S3Client, HeadBucketCommand, CreateBucketCommand, PutBucketLifecycleConfigurationCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';
export const log = pino({redact:['password','secret','authorization'],level:'info'});
export const db = new PrismaClient({adapter:new PrismaPg({connectionString:config.DATABASE_URL,max:10,connectionTimeoutMillis:5000})});
// HTTP-facing operations fail promptly; only BullMQ's consumer uses unlimited command retries.
export const redis = new Redis(config.REDIS_URL,{maxRetriesPerRequest:1,commandTimeout:5000,connectTimeout:5000});
redis.on('error',()=>log.warn('Redis connection unavailable'));
export const queue = new Queue('images',{connection:redis});
queue.on('error',()=>log.warn('Queue connection unavailable'));
const opts = {region:config.S3_REGION,forcePathStyle:true,credentials:{accessKeyId:config.S3_ACCESS_KEY,secretAccessKey:config.S3_SECRET_KEY}};
export const s3 = new S3Client({...opts,endpoint:config.S3_ENDPOINT,maxAttempts:2,requestHandler:{connectionTimeout:3000,requestTimeout:10000}});
export const publicS3 = new S3Client({...opts,endpoint:config.S3_PUBLIC_ENDPOINT??config.S3_ENDPOINT});
export async function signed(bucket:string,key:string,download=false) {
  return getSignedUrl(publicS3,new GetObjectCommand({Bucket:bucket,Key:key,...(download?{ResponseContentDisposition:'attachment; filename="processed-image.'+(key.split('.').pop()||'img')+'"'}:{})}),{expiresIn:300});
}
export async function initStorage() {
  for (const Bucket of [config.S3_ORIGINAL_BUCKET,config.S3_OUTPUT_BUCKET]) {
    try { await s3.send(new HeadBucketCommand({Bucket})); } catch(e:any) {
      if (e.$metadata?.httpStatusCode!==404) throw e;
      try { await s3.send(new CreateBucketCommand({Bucket})); } catch(err:any) {if(err.name!=='BucketAlreadyOwnedByYou') throw err;}
    }
    await s3.send(new PutBucketLifecycleConfigurationCommand({Bucket,LifecycleConfiguration:{Rules:[{ID:'retention',Status:'Enabled',Filter:{Prefix:''},Expiration:{Days:config.RETENTION_DAYS}}]}}));
  }
}
export const queueId = (id:string,generation:number) => `${id}-g${generation}`;
