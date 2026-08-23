import {spawn} from 'node:child_process';
import {BACKEND_PROTOCOL_VERSION} from '../backend/src/version.js';

const children=new Set();let stopping=false;
const shutdown=code=>{if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),120)};
const start=(label,args)=>{const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});children.add(child);child.once('exit',code=>{children.delete(child);if(!stopping){console.error(`${label} stopped with code ${code}.`);shutdown(code||1)}});return child};
const backendPort=Number.parseInt(process.env.AERIS_BACKEND_PORT,10)||4318,backendUrl=`http://127.0.0.1:${backendPort}`;
const existingBackend=async()=>{
  let response;try{response=await fetch(`${backendUrl}/api/health`,{signal:AbortSignal.timeout(900)})}catch{return false}
  let payload={};try{payload=await response.json()}catch{}
  if(response.ok&&payload.service==='aeris-backend'&&payload.protocolVersion===BACKEND_PROTOCOL_VERSION)return true;
  if(response.ok&&payload.service==='aeris-backend')throw new Error(`An older Aeris Backend is already running on port ${backendPort}. Stop the previous pnpm dev process and try again.`);
  throw new Error(`Port ${backendPort} is already in use by a service that is not Aeris Backend.`);
};

try{
  if(await existingBackend())console.log(`Reusing Aeris backend at ${backendUrl}`);
  else start('Aeris backend',['backend/src/server.js']);
  start('Vite',['node_modules/vite/bin/vite.js','--host','0.0.0.0']);
}catch(error){console.error(error.message);process.exit(1)}

process.once('SIGINT',()=>shutdown(0));
process.once('SIGTERM',()=>shutdown(0));
