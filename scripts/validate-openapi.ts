import SwaggerParser from '@apidevtools/swagger-parser';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { openapi } from '../backend/src/openapi.js';

async function validate(label:string,document:unknown) {
  // Clone because dereferencing mutates its input; all project references are internal.
  const parsed=await SwaggerParser.validate(JSON.parse(JSON.stringify(document)),{resolve:{external:false}});
  if(!('openapi' in parsed))throw new Error('Expected an OpenAPI document');
  console.log(JSON.stringify({document:label,openapi:parsed.openapi,paths:Object.keys(parsed.paths??{}).length,validation:'schema and references passed'}));
}

await validate('backend/src/openapi.ts',openapi);
const target=process.argv[2];
if(target&&/^https?:\/\//.test(target)){
  const response=await fetch(target,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`OpenAPI endpoint returned HTTP ${response.status}`);
  const location=new URL(target);
  const document=await response.json();
  await validate(`${location.origin}${location.pathname}`,document);
  assert.deepEqual(document,JSON.parse(JSON.stringify(openapi)),'Served OpenAPI differs from source; rebuild/redeploy the API.');
  console.log(JSON.stringify({sourceParity:'passed'}));
}else if(target){
  const document=JSON.parse((await readFile(target,'utf8')).replace(/^\uFEFF/,''));
  await validate(target,document);
  assert.deepEqual(document,JSON.parse(JSON.stringify(openapi)),'Saved OpenAPI differs from source; rebuild/redeploy the API.');
  console.log(JSON.stringify({sourceParity:'passed'}));
}
