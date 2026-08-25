import { Type } from '@earendil-works/pi-ai';

const result=(text,details={})=>({content:[{type:'text',text}],details});

export class AgentQueryService {
  constructor(){this.pending=new Map()}
  start(){}
  stop(){for(const query of this.pending.values())query.reject(new Error('Future stopped before the question was answered.'));this.pending.clear()}

  pendingForSession(sessionId){const query=[...this.pending.values()].find(item=>item.sessionId===sessionId);return query?this.#public(query):null}

  resolve(toolCallId,choice){
    const query=this.pending.get(String(toolCallId));if(!query||!['enable','disable'].includes(choice))return false;
    this.pending.delete(query.toolCallId);query.cleanup();query.resolve(choice);
    this.kernel?.bus.emit('agent:query-user',{...this.#public(query),phase:'answered',choice});return true;
  }

  tool(){
    const base={name:'query_user',label:'Clarify app requirements',description:'Ask whether a new Future app should expose desktop widget extension capabilities. Use only during new app creation and only when the user has not stated this requirement.',parameters:Type.Object({topic:Type.Literal('app-widget-extension',{description:'The only supported clarification topic.'}),appName:Type.String({description:'Concise user-facing name of the app being created.'})},{additionalProperties:false}),executionMode:'sequential'};
    base.forSession=sessionId=>({...base,forSession:undefined,execute:(toolCallId,input,signal,onUpdate)=>this.#execute(sessionId,toolCallId,input,signal,onUpdate)});return base;
  }

  async #execute(sessionId,toolCallId,input,signal,onUpdate){
    if(input.topic!=='app-widget-extension')throw new Error('query_user currently supports only app widget-extension clarification.');
    const appName=String(input.appName||'').trim().slice(0,80);if(!appName)throw new Error('query_user requires the application name.');
    if([...this.pending.values()].some(item=>item.sessionId===sessionId))throw new Error('A user clarification is already pending for this conversation.');
    const state={toolCallId:String(toolCallId),sessionId:String(sessionId),name:'query_user',label:'Clarify app requirements',operation:'app-widget-extension',topic:input.topic,appName,phase:'query',startedAt:Date.now()};
    onUpdate?.(result('Waiting for the user to choose whether this app should support desktop widgets.',state));
    const choice=await new Promise((resolve,reject)=>{
      const onAbort=()=>{this.pending.delete(state.toolCallId);this.kernel?.bus.emit('agent:query-user',{...this.#public(state),phase:'cancelled'});reject(new Error('User clarification was cancelled.'))};
      const cleanup=()=>signal?.removeEventListener('abort',onAbort);if(signal?.aborted)return onAbort();
      signal?.addEventListener('abort',onAbort,{once:true});this.pending.set(state.toolCallId,{...state,resolve,reject,cleanup});this.kernel?.bus.emit('agent:query-user',this.#public(state));
    });
    const widgetExtension=choice==='enable';
    return result(widgetExtension?`The user chose to include desktop widget extension capabilities for “${appName}”. Define a public widget data contract in the app package.`:`The user chose to create “${appName}” without desktop widget extension capabilities. Do not add a widget provider contract.`,{...state,phase:'completed',finishedAt:Date.now(),result:{widgetExtension}});
  }

  #public(query){return{toolCallId:query.toolCallId,sessionId:query.sessionId,name:query.name,label:query.label,operation:query.operation,topic:query.topic,appName:query.appName,phase:query.phase||'query',startedAt:query.startedAt}}
}
