import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

const CLIENT={name:'aeris-browser-backend',version:'0.1.0'};

export class StdioMcpClient{
  constructor({command,args=[],env=process.env,timeout=30000}){this.command=command;this.args=args;this.env=env;this.timeout=timeout;this.sequence=0;this.pending=new Map();this.tools=[];this.state='idle';this.stderr=[]}
  status(){return{state:this.state,command:this.command,tools:this.tools.map(tool=>({name:tool.name,description:tool.description||''})),error:this.error||'',stderr:this.stderr.slice(-8)}}
  async connect(){
    if(this.state==='ready')return this.status();
    if(this.connecting)return this.connecting;
    this.connecting=this.#connect();
    try{return await this.connecting}finally{this.connecting=null}
  }
  async #connect(){
    this.state='connecting';this.error='';this.stderr=[];
    try{
      this.child=spawn(this.command,this.args,{env:this.env,stdio:['pipe','pipe','pipe'],shell:false});
      createInterface({input:this.child.stdout}).on('line',line=>this.#message(line));
      createInterface({input:this.child.stderr}).on('line',line=>{this.stderr.push(line.slice(0,1000));this.stderr=this.stderr.slice(-40)});
      this.child.once('error',error=>this.#closed(error));
      this.child.once('exit',(code,signal)=>this.#closed(new Error(`Browser Use MCP exited (${signal||code}).`)));
      await this.#request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:CLIENT});
      this.#notify('notifications/initialized',{});
      const result=await this.#request('tools/list',{});this.tools=Array.isArray(result?.tools)?result.tools:[];this.state='ready';return this.status();
    }catch(error){this.state='failed';this.error=error.message;this.child?.kill('SIGTERM');throw error}
  }
  async callTool(name,args={}){await this.connect();if(!this.tools.some(tool=>tool.name===name))throw new Error(`Browser Use MCP tool is unavailable: ${name}`);return this.#request('tools/call',{name,arguments:args})}
  async stop(){const child=this.child;this.child=null;this.state='idle';this.tools=[];if(!child)return;for(const pending of this.pending.values())pending.reject(new Error('Browser Use MCP stopped.'));this.pending.clear();child.kill('SIGTERM')}
  #request(method,params){
    if(!this.child?.stdin?.writable)throw new Error('Browser Use MCP is not running.');
    const id=++this.sequence,message={jsonrpc:'2.0',id,method,params};
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Browser Use MCP timed out while calling ${method}.`))},this.timeout);this.pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});this.child.stdin.write(`${JSON.stringify(message)}\n`)})
  }
  #notify(method,params){if(this.child?.stdin?.writable)this.child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',method,params})}\n`)}
  #message(line){
    let message;try{message=JSON.parse(line)}catch{return}
    if(message.id==null)return;const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);
    if(message.error)pending.reject(new Error(message.error.message||'Browser Use MCP request failed.'));else pending.resolve(message.result);
  }
  #closed(error){if(this.state==='idle')return;this.state='failed';this.error=error.message;for(const pending of this.pending.values())pending.reject(error);this.pending.clear();this.child=null}
}
