import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserAutomationService,BROWSER_OPERATIONS} from '../src/browser/BrowserAutomationService.js';

test('browser automation exposes only allowlisted MCP operations',async()=>{
  const calls=[],client={status:()=>({state:'idle',tools:[]}),connect:async()=>{},callTool:async(name,args)=>{calls.push({name,args});return{content:[]}},stop:async()=>{}};
  const service=new BrowserAutomationService(client);
  await service.execute('navigate',{url:'https://example.com'});
  assert.deepEqual(calls,[{name:'browser_navigate',args:{url:'https://example.com'}}]);
  assert.deepEqual(Object.keys(BROWSER_OPERATIONS),['navigate','get_state','click','type','scroll','back','list_tabs','switch_tab','close_tab','extract_content']);
  await assert.rejects(()=>service.execute('evaluate',{code:'process.exit()'}),/Unsupported browser operation/);
});
