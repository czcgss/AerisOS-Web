const integer=(value,fallback,min,max)=>Math.max(min,Math.min(max,Number.parseInt(value,10)||fallback));
const list=(value,fallback)=>String(value||fallback).split(',').map(item=>item.trim()).filter(Boolean);
const boolean=(value,fallback=true)=>value==null?fallback:!['0','false','no','off'].includes(String(value).toLowerCase());
const commandArgs=(value,cdpUrl)=>{
  if(!value)return['--from','browser-use[cli]','browser-use','--cdp-url',cdpUrl,'--mcp'];
  try{const parsed=JSON.parse(value);if(Array.isArray(parsed)&&parsed.every(item=>typeof item==='string'))return parsed}catch{}
  throw new Error('FUTURE_BROWSER_USE_ARGS must be a JSON array of strings.');
};

export const loadConfig=(env=process.env)=>{
  const cdpPort=integer(env.FUTURE_CHROMIUM_CDP_PORT,9333,1,65535),cdpUrl=`http://127.0.0.1:${cdpPort}`;
  return{
    host:env.FUTURE_BACKEND_HOST||'127.0.0.1',
    port:integer(env.FUTURE_BACKEND_PORT,4318,1,65535),
    allowedOrigins:new Set(list(env.FUTURE_ALLOWED_ORIGINS,'http://localhost:5173,http://127.0.0.1:5173')),
    requestLimit:integer(env.FUTURE_REQUEST_LIMIT,1024*1024,1024,8*1024*1024),
    chromium:{url:cdpUrl,port:cdpPort,executable:env.FUTURE_CHROMIUM_EXECUTABLE||'',profile:env.FUTURE_CHROMIUM_PROFILE||join(homedir(),'.future','browser-profile'),headless:boolean(env.FUTURE_CHROMIUM_HEADLESS,true),width:integer(env.FUTURE_BROWSER_VIEW_WIDTH,1280,640,2560),height:integer(env.FUTURE_BROWSER_VIEW_HEIGHT,720,480,1600),timeout:integer(env.FUTURE_CHROMIUM_TIMEOUT,15000,1000,60000)},
    browserUse:{command:env.FUTURE_BROWSER_USE_COMMAND||'uvx',args:commandArgs(env.FUTURE_BROWSER_USE_ARGS,cdpUrl),timeout:integer(env.FUTURE_BROWSER_USE_TIMEOUT,30000,1000,180000)},
  };
};
import {homedir} from 'node:os';
import {join} from 'node:path';
