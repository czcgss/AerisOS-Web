import {createServer} from 'node:http';
import {loadConfig} from './config.js';
import {HttpError,readJson,sendJson} from './http/json.js';
import {acceptWebSocket,rejectWebSocket} from './http/websocket.js';
import {StdioMcpClient} from './mcp/StdioMcpClient.js';
import {BrowserAutomationService} from './browser/BrowserAutomationService.js';
import {ChromiumSessionService} from './browser/ChromiumSessionService.js';
import {BACKEND_PROTOCOL_VERSION} from './version.js';

const corsHeaders=(request,config)=>{
  const origin=request.headers.origin;if(!origin)return{};
  if(!config.allowedOrigins.has(origin))throw new HttpError(403,'Origin is not allowed.','origin_denied');
  return{'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,DELETE,OPTIONS','access-control-allow-headers':'content-type','vary':'Origin'};
};

export const createBackend=(options={})=>{
  const config=options.config||loadConfig(),client=options.client||new StdioMcpClient(config.browserUse),chromium=options.chromium||new ChromiumSessionService(config.chromium),browser=options.browser||new BrowserAutomationService(client,chromium);
  const server=createServer(async(request,response)=>{
    let headers={};
    try{
      headers=corsHeaders(request,config);
      if(request.method==='OPTIONS'){response.writeHead(204,headers);response.end();return}
      const url=new URL(request.url,'http://future.local');
      if(request.method==='GET'&&url.pathname==='/api/health'){sendJson(response,200,{status:'ok',service:'future-backend',protocolVersion:BACKEND_PROTOCOL_VERSION,browser:browser.status()},headers);return}
      if(request.method==='GET'&&url.pathname==='/api/browser/capabilities'){const state=url.searchParams.get('connect')==='1'?await browser.connect():browser.status();sendJson(response,200,state,headers);return}
      if(request.method==='GET'&&url.pathname==='/api/browser/view'){sendJson(response,200,await browser.view(),headers);return}
      if(request.method==='POST'&&url.pathname==='/api/browser/view/navigate'){const body=await readJson(request,config.requestLimit);sendJson(response,200,await browser.navigate(body.url),headers);return}
      if(request.method==='POST'&&url.pathname==='/api/browser/view/pointer'){sendJson(response,200,await browser.pointer(await readJson(request,config.requestLimit)),headers);return}
      if(request.method==='POST'&&url.pathname==='/api/browser/view/key'){sendJson(response,200,await browser.key(await readJson(request,config.requestLimit)),headers);return}
      if(request.method==='POST'&&url.pathname==='/api/browser/view/history'){const body=await readJson(request,config.requestLimit);sendJson(response,200,await browser.history(body.direction),headers);return}
      if(request.method==='POST'&&url.pathname==='/api/browser/view/reload'){sendJson(response,200,await browser.reload(),headers);return}
      if(request.method==='POST'&&url.pathname==='/api/browser/actions'){
        const body=await readJson(request,config.requestLimit),operation=String(body.operation||'').trim();if(!operation)throw new HttpError(400,'Browser operation is required.','operation_required');
        sendJson(response,200,await browser.execute(operation,body.args),headers);return;
      }
      if(request.method==='DELETE'&&url.pathname==='/api/browser/session'){await browser.stop();sendJson(response,200,{stopped:true},headers);return}
      throw new HttpError(404,'Backend route not found.','not_found');
    }catch(error){const status=error.status||503;sendJson(response,status,{error:{code:error.code||'backend_unavailable',message:error.message||'Backend request failed.'}},headers)}
  });
  server.on('upgrade',(request,socket)=>{
    try{
      const url=new URL(request.url,'http://future.local'),origin=request.headers.origin;if(url.pathname!=='/api/browser/stream'){rejectWebSocket(socket,404,'WebSocket route not found.');return}if(origin&&!config.allowedOrigins.has(origin)){rejectWebSocket(socket,403,'Origin is not allowed.');return}
      const connection=acceptWebSocket(request,socket);let latest=null,sending=false;
      const flush=()=>{if(sending||!latest||connection.buffered()>1024*1024)return;sending=true;const value=latest;latest=null;connection.send(value);sending=false;if(latest)queueMicrotask(flush)};
      const unsubscribe=browser.subscribe(event=>{latest=event;flush()});
      socket.on('close',unsubscribe);socket.on('error',unsubscribe);socket.on('data',data=>{if((data[0]&0x0f)===0x8){unsubscribe();connection.close()}});
    }catch(error){rejectWebSocket(socket,503,error.message)}
  });
  return{server,browser,config,close:async()=>{await browser.stop();await new Promise(resolve=>server.close(()=>resolve()))}};
};
