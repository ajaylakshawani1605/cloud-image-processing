import {readFile,readdir} from 'node:fs/promises';
import {parseAllDocuments} from 'yaml';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);let checked=0;
async function walk(url){for(const item of await readdir(url,{withFileTypes:true})){const file=new URL(item.name+(item.isDirectory()?'/':''),url);if(item.isDirectory())await walk(file);else if(/\.ya?ml$/.test(item.name)){const docs=parseAllDocuments(await readFile(file,'utf8'));for(const doc of docs){assert.equal(doc.errors.length,0,`${file}: ${doc.errors}`);const value=doc.toJSON();if(value?.kind==='Deployment'){for(const c of value.spec.template.spec.containers){assert(c.resources?.requests&&c.resources?.limits,`${file}: resources missing`);assert(c.readinessProbe&&c.livenessProbe,`${file}: probes missing`);}}}checked++;}else if(item.name.endsWith('.json')){JSON.parse(await readFile(file,'utf8'));checked++;}}}
await walk(new URL('infrastructure/',root));
const compose=parseAllDocuments(await readFile(new URL('docker-compose.yml',root),'utf8'))[0];assert.equal(compose.errors.length,0);const config=compose.toJSON();for(const name of ['frontend','api','worker','postgres','redis','minio','prometheus','grafana'])assert(config.services[name]);
const scaler=parseAllDocuments(await readFile(new URL('infrastructure/kubernetes/keda.yaml',root),'utf8'))[0].toJSON();assert.equal(scaler.spec.scaleTargetRef.name,'worker');assert.equal(scaler.spec.triggers[0].metadata.listName,'bull:images:wait');assert(scaler.spec.minReplicaCount>=1);
console.log(`Validated ${checked+1} YAML/JSON files, required services, deployment probes/resources and queue/scaler contract. This is static validation, not a Docker or Kubernetes deployment.`);
