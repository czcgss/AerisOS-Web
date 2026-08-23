import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackend} from '../src/app.js';

const config={host:'127.0.0.1',port:0,allowedOrigins:new Set(['http://127.0.0.1:5173']),requestLimit:4096,browserUse:{command:'unused',args:[],timeout:1000}};

test('backend health is lazy and browser actions are delegated',async()=>{
  const calls=[],browser={status:()=>({state:'idle',operations:['navigate']}),connect:async()=>({state:'ready'}),execute:async(operation,args)=>{calls.push({operation,args});return{ok:true}},stop:async()=>{}};
  const backend=createBackend({config,browser});await new Promise(resolve=>backend.server.listen(0,'127.0.0.1',resolve));const {port}=backend.server.address(),base=`http://127.0.0.1:${port}`;
  try{
    const health=await fetch(`${base}/api/health`).then(response=>response.json());assert.equal(health.status,'ok');assert.equal(calls.length,0);
    const action=await fetch(`${base}/api/browser/actions`,{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:5173'},body:JSON.stringify({operation:'navigate',args:{url:'https://example.com'}})}).then(response=>response.json());assert.equal(action.ok,true);assert.deepEqual(calls,[{operation:'navigate',args:{url:'https://example.com'}}]);
  }finally{await backend.close()}
});
