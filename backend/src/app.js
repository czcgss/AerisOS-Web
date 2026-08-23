import {createServer} from 'node:http';
import {loadConfig} from './config.js';
import {HttpError,readJson,sendJson} from './http/json.js';
import {StdioMcpClient} from './mcp/StdioMcpClient.js';
import {BrowserAutomationService} from './browser/BrowserAutomationService.js';

const corsHeaders=(request,config)=>{
  const origin=request.headers.origin;if(!origin)return{};
  if(!config.allowedOrigins.has(origin))throw new HttpError(403,'Origin is not allowed.','origin_denied');
  return{'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST,DELETE,OPTIONS','access-control-allow-headers':'content-type','vary':'Origin'};
};

export const createBackend=(options={})=>{
  const config=options.config||loadConfig(),client=options.client||new StdioMcpClient(config.browserUse),browser=options.browser||new BrowserAutomationService(client);
  const server=createServer(async(request,response)=>{
    let headers={};
    try{
      headers=corsHeaders(request,config);
      if(request.method==='OPTIONS'){response.writeHead(204,headers);response.end();return}
      const url=new URL(request.url,'http://aeris.local');
      if(request.method==='GET'&&url.pathname==='/api/health'){sendJson(response,200,{status:'ok',service:'aeris-backend',browser:browser.status()},headers);return}
      if(request.method==='GET'&&url.pathname==='/api/browser/capabilities'){const state=url.searchParams.get('connect')==='1'?await browser.connect():browser.status();sendJson(response,200,state,headers);return}
      if(request.method==='POST'&&url.pathname==='/api/browser/actions'){
        const body=await readJson(request,config.requestLimit),operation=String(body.operation||'').trim();if(!operation)throw new HttpError(400,'Browser operation is required.','operation_required');
        sendJson(response,200,await browser.execute(operation,body.args),headers);return;
      }
      if(request.method==='DELETE'&&url.pathname==='/api/browser/session'){await browser.stop();sendJson(response,200,{stopped:true},headers);return}
      throw new HttpError(404,'Backend route not found.','not_found');
    }catch(error){const status=error.status||503;sendJson(response,status,{error:{code:error.code||'backend_unavailable',message:error.message||'Backend request failed.'}},headers)}
  });
  return{server,browser,config,close:async()=>{await browser.stop();await new Promise(resolve=>server.close(()=>resolve()))}};
};
