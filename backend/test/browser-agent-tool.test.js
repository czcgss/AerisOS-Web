import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserService} from '../../src/services/BrowserService.js';
import {SystemToolService} from '../../src/services/SystemToolService.js';

test('browser Agent navigation opens the visible Activity view and shared Chromium page',async()=>{
  const memory=new Map(),storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)},browser=new BrowserService({storage});browser.start();
  const app={id:'browser',title:'webBrowser',icon:'browser',color:'blue'},registry={get:id=>id==='browser'?app:null,list:()=>[app],subscribe:()=>()=>{}},navigations=[],events=[],browserAutomation={navigate:async url=>{navigations.push(url);return{url,title:'Baidu'}},history:async()=>({url:'https://www.baidu.com/'}),execute:async()=>({})};
  const tools=new SystemToolService({browser,browserAutomation,registry,i18n:{t:value=>value}});tools.kernel={bus:{emit:(name,detail)=>events.push({name,detail})}};
  const browserTool=tools.agentTools().find(tool=>tool.name==='aeris_browser');assert.ok(browserTool);
  await browserTool.execute('browser-call',{type:'navigate',url:'baidu.com'},new AbortController().signal,()=>{});
  assert.deepEqual(navigations,['https://baidu.com/']);assert.equal(browser.active().url,'https://baidu.com/');assert.deepEqual(events.find(event=>event.name==='agent:open-app')?.detail,{appId:'browser',operation:'navigate',url:'https://baidu.com/'});
});
