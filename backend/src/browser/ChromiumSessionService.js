import {spawn} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {homedir,platform,tmpdir} from 'node:os';
import {join} from 'node:path';
import {CdpConnection} from './CdpConnection.js';

const candidates=()=>platform()==='darwin'?[
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]:platform()==='win32'?[
  `${process.env.PROGRAMFILES||'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
]:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/microsoft-edge'];

const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const safeUrl=value=>{const url=new URL(String(value||''));if(!['http:','https:','about:'].includes(url.protocol))throw new Error('Chromium supports HTTP and HTTPS pages only.');return url.toString()};

export class ChromiumSessionService{
  constructor(config){this.config=config;this.state='idle';this.error='';this.target=null;this.connection=null;this.process=null;this.subscribers=new Set();this.screencasting=false;this.eventDisposers=[]}
  status(){return{state:this.state,error:this.error,url:this.target?.url||'about:blank',title:this.target?.title||'New Tab',viewport:{width:this.config.width,height:this.config.height},cdpUrl:this.config.url}}
  async connect(){if(this.state==='ready'&&this.connection?.isOpen())return this.status();if(this.connecting)return this.connecting;this.connecting=this.#connect();try{return await this.connecting}finally{this.connecting=null}}
  async #connect(){
    this.state='connecting';this.error='';
    try{
      if(!await this.#endpointReady())this.#launch();
      await this.#waitForEndpoint();await this.#attach();this.state='ready';return this.status();
    }catch(error){this.state='failed';this.error=error.message;throw error}
  }
  async navigate(url){await this.connect();url=safeUrl(url);await this.connection.send('Page.navigate',{url});await this.#settle();return this.view()}
  async view(){await this.connect();await this.#refreshTarget();const shot=await this.connection.send('Page.captureScreenshot',{format:'jpeg',quality:78,fromSurface:true});return{...this.status(),screenshot:{mimeType:'image/jpeg',data:shot.data}}}
  subscribe(listener){this.subscribers.add(listener);this.connect().then(()=>this.#startScreencast()).catch(error=>listener({type:'error',message:error.message}));return()=>{this.subscribers.delete(listener);if(!this.subscribers.size)this.#stopScreencast().catch(()=>{})}}
  async pointer({x,y,type='click',button='left',deltaX=0,deltaY=0}){
    await this.connect();x=Math.max(0,Math.min(this.config.width,Number(x)||0));y=Math.max(0,Math.min(this.config.height,Number(y)||0));
    if(type==='scroll')await this.connection.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:Number(deltaX)||0,deltaY:Number(deltaY)||0});
    else{await this.connection.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button,clickCount:1});await this.connection.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button,clickCount:1})}
    return this.status();
  }
  async key({key,text=''}){await this.connect();const value=String(key||'');if(text)await this.connection.send('Input.insertText',{text:String(text)});else{await this.connection.send('Input.dispatchKeyEvent',{type:'keyDown',key:value,code:value});await this.connection.send('Input.dispatchKeyEvent',{type:'keyUp',key:value,code:value})}return this.status()}
  async back(){await this.connect();const history=await this.connection.send('Page.getNavigationHistory'),entry=history.entries?.[history.currentIndex-1];if(entry)await this.connection.send('Page.navigateToHistoryEntry',{entryId:entry.id});await this.#settle();return this.view()}
  async forward(){await this.connect();const history=await this.connection.send('Page.getNavigationHistory'),entry=history.entries?.[history.currentIndex+1];if(entry)await this.connection.send('Page.navigateToHistoryEntry',{entryId:entry.id});await this.#settle();return this.view()}
  async reload(){await this.connect();await this.connection.send('Page.reload',{ignoreCache:false});await this.#settle();return this.view()}
  async stop(){
    await this.#stopScreencast().catch(()=>{});this.eventDisposers.splice(0).forEach(dispose=>dispose());
    const connection=this.connection,process=this.process;this.connection=null;this.process=null;this.state='idle';this.target=null;this.error='';
    if(process?.exitCode===null){
      await connection?.send('Browser.close').catch(()=>{});
      if(process.exitCode===null)process.kill('SIGTERM');
      await new Promise(resolve=>{if(process.exitCode!==null)return resolve();let giveUp;const force=setTimeout(()=>{if(process.exitCode===null)process.kill('SIGKILL')},1500),done=()=>{clearTimeout(force);clearTimeout(giveUp);resolve()};process.once('exit',done);giveUp=setTimeout(()=>{process.off('exit',done);done()},2500)});
    }
    connection?.close();
  }
  #launch(){
    const executable=this.config.executable||candidates().find(existsSync);if(!executable)throw new Error('No supported Chromium browser was found. Set AERIS_CHROMIUM_EXECUTABLE.');
    const profile=this.config.profile||join(homedir?.()||tmpdir(),'Library','Application Support','AerisOS','Browser');mkdirSync(profile,{recursive:true});
    const visibility=this.config.headless?['--headless=new']:[];
    this.process=spawn(executable,[...visibility,`--remote-debugging-port=${this.config.port}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--hide-scrollbars',`--window-size=${this.config.width},${this.config.height}`,'about:blank'],{stdio:'ignore',detached:false});
    this.process.once('exit',()=>{if(this.state!=='idle'){this.state='failed';this.error='Chromium stopped.'}this.connection=null;this.process=null});
  }
  async #endpointReady(){try{return(await fetch(`${this.config.url}/json/version`)).ok}catch{return false}}
  async #waitForEndpoint(){for(let attempt=0;attempt<60;attempt++){if(await this.#endpointReady())return;await delay(250)}throw new Error('Chromium remote debugging did not become ready.')}
  async #attach(){
    const targets=await fetch(`${this.config.url}/json/list`).then(response=>response.json());this.target=targets.find(item=>item.type==='page');
    if(!this.target)this.target=await fetch(`${this.config.url}/json/new?about%3Ablank`,{method:'PUT'}).then(response=>response.json());
    this.eventDisposers.splice(0).forEach(dispose=>dispose());this.connection?.close();this.connection=new CdpConnection(this.target.webSocketDebuggerUrl,{timeout:this.config.timeout});await this.connection.connect();await this.connection.send('Page.enable');await this.connection.send('Runtime.enable');await this.connection.send('Emulation.setDeviceMetricsOverride',{width:this.config.width,height:this.config.height,deviceScaleFactor:1,mobile:false});
    this.eventDisposers.push(this.connection.on('Page.screencastFrame',event=>this.#frame(event)),this.connection.on('Page.frameNavigated',()=>this.#navigation()));if(this.subscribers.size)await this.#startScreencast();
  }
  async #refreshTarget(){try{const value=await this.connection.send('Runtime.evaluate',{expression:'({url:location.href,title:document.title})',returnByValue:true}),state=value.result?.value||{};this.target={...this.target,url:state.url||this.target?.url,title:state.title||this.target?.title}}catch{}return this.target}
  async #settle(){await delay(350);await this.#refreshTarget()}
  async #startScreencast(){if(this.screencasting||!this.connection||!this.subscribers.size)return;await this.connection.send('Page.startScreencast',{format:'jpeg',quality:76,maxWidth:this.config.width,maxHeight:this.config.height,everyNthFrame:1});this.screencasting=true}
  async #stopScreencast(){if(!this.screencasting||!this.connection)return;this.screencasting=false;await this.connection.send('Page.stopScreencast')}
  #frame(event){this.connection?.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});const frame={type:'frame',screenshot:{mimeType:'image/jpeg',data:event.data},metadata:event.metadata||{},viewport:{width:this.config.width,height:this.config.height},url:this.target?.url||'',title:this.target?.title||''};for(const listener of this.subscribers)try{listener(frame)}catch{}}
  async #navigation(){try{await this.#refreshTarget();const state={type:'navigation',...this.status()};for(const listener of this.subscribers)try{listener(state)}catch{}}catch{}}
}
