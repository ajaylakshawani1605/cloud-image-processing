import SwaggerParser from '@apidevtools/swagger-parser';
import { describe,expect,it } from 'vitest';
import { openapi } from '../backend/src/openapi.js';

const clone=()=>JSON.parse(JSON.stringify(openapi));
const validate=(document:ReturnType<typeof clone>)=>SwaggerParser.validate(document,{resolve:{external:false}});

describe('OpenAPI schema and reference validation',()=>{
  it('validates every resource and resolves all internal schemas',async()=>{
    const document=await validate(clone());
    expect(document.openapi).toBe('3.0.3');
    expect(Object.keys(document.paths??{})).toHaveLength(13);
    expect(document.paths?.['/jobs']?.post?.responses?.['202']).toBeDefined();
    expect(document.paths?.['/jobs/{id}/events']).toBeDefined();
  });
  it('rejects the previous malformed nesting of components under paths',async()=>{
    const malformed=clone();malformed.paths.components=malformed.components;delete malformed.components;
    await expect(validate(malformed)).rejects.toThrow();
  });
  it('rejects an unresolved response-schema reference',async()=>{
    const malformed=clone();malformed.components.schemas.Job.properties.upload.$ref='#/components/schemas/MissingUpload';
    await expect(validate(malformed)).rejects.toThrow();
  });
});
