const integer=(value,fallback,min,max)=>Math.max(min,Math.min(max,Number.parseInt(value,10)||fallback));
const list=(value,fallback)=>String(value||fallback).split(',').map(item=>item.trim()).filter(Boolean);
const commandArgs=value=>{
  if(!value)return['--from','browser-use[cli]','browser-use','--mcp'];
  try{const parsed=JSON.parse(value);if(Array.isArray(parsed)&&parsed.every(item=>typeof item==='string'))return parsed}catch{}
  throw new Error('AERIS_BROWSER_USE_ARGS must be a JSON array of strings.');
};

export const loadConfig=(env=process.env)=>({
  host:env.AERIS_BACKEND_HOST||'127.0.0.1',
  port:integer(env.AERIS_BACKEND_PORT,4318,1,65535),
  allowedOrigins:new Set(list(env.AERIS_ALLOWED_ORIGINS,'http://localhost:5173,http://127.0.0.1:5173')),
  requestLimit:integer(env.AERIS_REQUEST_LIMIT,1024*1024,1024,8*1024*1024),
  browserUse:{
    command:env.AERIS_BROWSER_USE_COMMAND||'uvx',
    args:commandArgs(env.AERIS_BROWSER_USE_ARGS),
    timeout:integer(env.AERIS_BROWSER_USE_TIMEOUT,30000,1000,180000),
  },
});
