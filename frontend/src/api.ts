import axios from 'axios';
export const api=axios.create({baseURL:'/api/v1',timeout:20000});
export type Settings={width?:number;height?:number;preserveAspect:boolean;quality:number;format:'webp'|'jpeg'|'png';rotate:0|90|180|270;grayscale:boolean;thumbnail:boolean;watermark?:string};
export type Upload={id:string;name:string;size:number;width:number;height:number;mime:string;previewUrl?:string;createdAt:string};
export type Job={id:string;upload:Upload;status:string;progress:number;transformations:Settings;attemptCount:number;error:string|null;durationMs:number|null;createdAt:string;startedAt:string|null;completedAt:string|null;originalUrl?:string;outputUrl?:string;outputMetadata?:{size:number;width:number;height:number;format:string};audit?:{id:string;type:string;message:string;createdAt:string}[]};
export type Stats={total:number;byStatus:Record<string,number>;averageDurationMs:number|null;queue:Record<string,number>;workers:number;activity:{day:string;completed:number;failed:number}[];limits:{maxUploadMB:number;maxImagePixels:number;retentionDays:number};timestamp:string};
export const defaults:Settings={preserveAspect:true,quality:82,format:'webp',rotate:0,grayscale:false,thumbnail:false};
export function preferences():Settings{try{const v=JSON.parse(localStorage.getItem('cloudframe-preferences')||'{}');return {...defaults,quality:Math.max(1,Math.min(100,Number(v.quality)||82)),format:['jpeg','png','webp'].includes(v.format)?v.format:'webp',preserveAspect:typeof v.preserveAspect==='boolean'?v.preserveAspect:true};}catch{return defaults;}}
export function message(error:unknown){return axios.isAxiosError(error)?error.response?.data?.error?.message||'Cannot reach the API. Check that the services are running.':error instanceof Error?error.message:'Something went wrong. Please try again.';}
export const bytes=(v:number)=>v<1024?`${v} B`:v<1048576?`${(v/1024).toFixed(1)} KB`:`${(v/1048576).toFixed(2)} MB`;
export const time=(v:string)=>new Date(v).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
export const download=async(id:string)=>{const {data}=await api.get(`/jobs/${id}/download`);window.open(data.url,'_blank','noopener,noreferrer');};
