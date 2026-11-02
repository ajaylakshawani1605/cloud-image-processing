const ref = (name:string) => ({$ref: `#/components/schemas/${name}`});
const str = {type:'string'};
const integer = {type:'integer'};
const uuid = {type:'string',format:'uuid'};
const date = {type:'string',format:'date-time'};
const object = (properties:Record<string,unknown>) => ({type:'object',properties});
const array = (items:object) => ({type:'array',items});
const json = (schema:object) => ({'application/json':{schema}});
const response = (description:string,schema:object) => ({description,content:json(schema)});
const error = response('Request could not be completed',ref('Error'));
const operation = (summary:string,schema:object,status='200',extraResponses:Record<string,object>={}) => ({
  summary,responses:{[status]:response(summary,schema),'400':error,'404':error,'409':error,'413':error,'429':error,'503':error,...extraResponses}
});
const body = (schema:object) => ({required:true,content:json(schema)});
const id = [{in:'path',name:'id',required:true,schema:uuid}];
const outputMetadata = object({width:integer,height:integer,size:integer,format:str,mime:str});
const schemas = {
  Error:object({error:object({message:str,requestId:str})}),
  Transformations:{
    type:'object',additionalProperties:false,
    properties:{
      width:{...integer,minimum:1,maximum:8192},
      height:{...integer,minimum:1,maximum:8192},
      preserveAspect:{type:'boolean',default:true},
      quality:{...integer,minimum:1,maximum:100,default:82},
      format:{type:'string',enum:['jpeg','png','webp'],default:'webp'},
      rotate:{...integer,enum:[0,90,180,270],default:0},
      grayscale:{type:'boolean',default:false},
      thumbnail:{type:'boolean',default:false},
      watermark:{type:'string',maxLength:80}
    }
  },
  Upload:object({
    id:uuid,name:str,mime:str,size:integer,width:integer,height:integer,
    previewUrl:{type:'string',format:'uri'},createdAt:date
  }),
  OutputMetadata:outputMetadata,
  AuditEvent:object({id:uuid,type:str,message:str,createdAt:date}),
  Job:object({
    id:uuid,uploadId:uuid,upload:ref('Upload'),transformations:ref('Transformations'),
    status:{type:'string',enum:['queued','processing','completed','failed','retrying']},
    progress:{...integer,minimum:0,maximum:100},generation:integer,attemptCount:integer,
    error:{...str,nullable:true},durationMs:{...integer,nullable:true},
    createdAt:date,updatedAt:date,startedAt:{...date,nullable:true},completedAt:{...date,nullable:true},
    outputMetadata:{...outputMetadata,nullable:true},
    originalUrl:{type:'string',format:'uri'},outputUrl:{type:'string',format:'uri',nullable:true},
    audit:array(ref('AuditEvent'))
  }),
  QueueCounts:object({wait:integer,active:integer,delayed:integer,failed:integer}),
  Stats:object({
    total:integer,byStatus:{type:'object',additionalProperties:integer},
    averageDurationMs:{type:'number',nullable:true},queue:ref('QueueCounts'),workers:integer,
    activity:array(object({day:str,completed:integer,failed:integer})),
    limits:object({maxUploadMB:integer,maxImagePixels:integer,retentionDays:integer}),timestamp:date
  })
};
const createRequest = {
  type:'object',required:['uploadIds','transformations'],additionalProperties:false,
  properties:{uploadIds:{...array(uuid),minItems:1,maxItems:8},transformations:ref('Transformations')}
};
export const openapi = {
  openapi:'3.0.3',
  info:{title:'CloudFrame Image Processing API',version:'1.0.0',
    description:'Single-tenant academic deployment. Asynchronous jobs; private download URLs expire after 300 seconds.'},
  servers:[{url:'/api/v1'}],
  paths:{
    '/images/upload':{
      post:{
        ...operation('Validate and store 1-8 images',object({uploads:array(ref('Upload'))}),'201'),
        requestBody:{
          required:true,
          content:{'multipart/form-data':{schema:{
            type:'object',required:['images'],
            properties:{images:{type:'array',minItems:1,maxItems:8,items:{type:'string',format:'binary'}}}
          }}}
        }
      }
    },
    '/jobs':{
      post:{...operation('Accept asynchronous image jobs',object({jobs:array(ref('Job'))}),'202'),requestBody:body(createRequest)},
      get:{
        ...operation('Paginated job history',object({jobs:array(ref('Job')),total:integer,page:integer,pages:integer})),
        parameters:[
          {in:'query',name:'page',schema:{...integer,minimum:1,default:1}},
          {in:'query',name:'limit',schema:{...integer,minimum:1,maximum:100,default:15}},
          {in:'query',name:'status',schema:{type:'string',enum:['queued','processing','completed','failed','retrying']}},
          {in:'query',name:'search',schema:{type:'string',maxLength:100}},
          {in:'query',name:'sort',schema:{type:'string',enum:['newest','oldest'],default:'newest'}}
        ]
      }
    },
    '/jobs/{id}':{parameters:id,get:operation('Job detail with audit and expiring preview URLs',ref('Job'))},
    '/jobs/{id}/download':{
      parameters:id,
      get:operation('Private download URL for a completed result',object({url:{type:'string',format:'uri'},expiresIn:integer}),'200',{'410':response('The retained result has expired',ref('Error'))})
    },
    '/jobs/{id}/retry':{parameters:id,post:operation('Retry a terminally failed job',ref('Job'),'202')},
    '/jobs/{id}/cancel':{
      parameters:id,
      post:{summary:'Cancellation is intentionally unsupported',responses:{'409':error,'404':error}}
    },
    '/jobs/{id}/events':{
      parameters:id,
      get:{
        summary:'SSE job snapshots every 2s; fall back to GET job polling',
        responses:{
          '200':{description:'Server-sent events; closes on terminal status or after 120 seconds',
            content:{'text/event-stream':{schema:{type:'string'}}}},
          '404':error,'429':error,'503':error
        }
      }
    },
    '/dashboard/stats':{get:operation('Database and BullMQ operational statistics',ref('Stats'))},
    '/health/live':{get:operation('Process liveness',object({status:str}))},
    '/health/ready':{get:operation('Dependency readiness',object({services:object({database:str,redis:str,storage:str})}))},
    '/metrics':{get:{summary:'Prometheus metrics',responses:{
      '200':{description:'Prometheus exposition',content:{'text/plain':{schema:str}}},'503':error
    }}},
    '/docs':{get:{summary:'Swagger UI',responses:{'200':{description:'Interactive API documentation'}}}},
    '/openapi.json':{get:operation('OpenAPI specification',{type:'object'})}
  },
  components:{schemas}
};
