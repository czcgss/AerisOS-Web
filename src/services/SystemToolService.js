import { Type, validateToolArguments } from '@earendil-works/pi-ai';
import { migrate as migrateCalendar, localDateTime, parseLocal } from '../apps/calendar/model.js';

const text = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const safeName = value => String(value || '').trim().replace(/[\r\n]/g, ' ');
const toolResult = (message, details) => ({ content: [{ type: 'text', text: message }], details });
const auditValue=(value,key='',depth=0)=>{
  if(/^(content|text|apiKey|password|token|authorization)$/i.test(key))return'[redacted]';
  if(typeof value==='string')return value.length>500?`${value.slice(0,500)}…`:value;
  if(value==null||typeof value!=='object')return value;
  if(depth>=3)return'[omitted]';
  if(Array.isArray(value))return value.slice(0,20).map(item=>auditValue(item,'',depth+1));
  return Object.fromEntries(Object.entries(value).slice(0,30).map(([name,item])=>[name,auditValue(item,name,depth+1)]));
};
const futurePath = value => {
  const source=String(value||'').trim();
  if(!source.startsWith('/')||source.includes('\0'))throw new Error('An absolute Future path is required.');
  const parts=[];
  for(const part of source.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)throw new Error('The path leaves the Future filesystem.');parts.pop();continue}
    parts.push(part);
  }
  const path=`/${parts.join('/')}`;
  if(path!=='/home/future'&&!path.startsWith('/home/future/')&&path!=='/mnt/future'&&!path.startsWith('/mnt/future/'))throw new Error('Files tools can only access /home/future or /mnt/future.');
  return path;
};
const futureName = value => {
  const name=safeName(value);
  if(!name||name==='.'||name==='..'||name.includes('/'))throw new Error('A valid file or folder name is required.');
  return name;
};
const mutableFuturePath = value => {
  const path=futurePath(value);
  if(path==='/home/future'||path==='/mnt/future')throw new Error('The root Future folders cannot be changed.');
  return path;
};

export class SystemToolService {
  constructor({ userdata, system, settings, themeRuntime, weather, metrics, machine, music, browser, browserAutomation, registry, i18n, operationHistory=null, automations=null, systemTasks=null }) {
    Object.assign(this, { userdata, system, settings, themeRuntime, weather, metrics, machine, music, browser, browserAutomation, registry, i18n, operationHistory, automations, systemTasks });
    this.definitions = new Map();
    this.executions = new Map();
    this.approvals = new Map();
    this.executionOwners = new Map();
    this.#registerBuiltins();
  }

  start() {
    this.offRegistry=this.registry.subscribe(change=>{
      if(change.type==='registered')this.#registerOpenApp(change.app);
      if(change.type==='unregistered')this.definitions.delete(`${change.app.id}_open_app`);
      this.kernel?.bus.emit('tools:changed',{appId:change.app.id,type:change.type});
    });
  }

  stop() { this.offRegistry?.();this.offRegistry=null; }

  list() { return [...this.definitions.values()].map(({ execute, parameters, ...metadata }) => ({ ...metadata })); }
  metadata(name) {
    const item=this.definitions.get(name);
    if(item){const {execute,parameters,...metadata}=item;return {...metadata};}
    const appId=String(name||'').replace(/^future_/,'');
    const definitions=[...this.definitions.values()].filter(definition=>definition.appId===appId),app=this.registry.get(appId);
    if(!definitions.length||!app)return null;
    return {name:`future_${appId}`,appId,operation:'app_capability',label:`${this.i18n.t(app.title)} tool`,description:definitions.map(definition=>`${definition.operation}: ${definition.description}`).join('\n'),risk:definitions.some(definition=>definition.risk==='high')?'mixed':'safe'};
  }
  execution(id) { return this.executions.get(id) ? structuredClone(this.executions.get(id)) : null; }
  pendingApproval(sessionId='') { const pending=[...this.approvals.keys()].map(id=>this.execution(id)).filter(Boolean),match=sessionId?pending.findLast(item=>item.sessionId===sessionId):pending.at(-1);return match||null; }
  resolveApproval(id, approved) { const pending=this.approvals.get(id);if(!pending)return false;this.approvals.delete(id);pending.resolve(!!approved);return true; }
  bindOwner(tool,owner={}){if(!tool?.execute)return tool;return{...tool,execute:async(toolCallId,...args)=>{this.executionOwners.set(String(toolCallId),owner);try{return await tool.execute(toolCallId,...args)}finally{this.executionOwners.delete(String(toolCallId))}}}}
  async runProtected({toolCallId,name,label,appId='',operation,params={},approvalMessage,sessionId='',turnId='',agentId='',agentName=''},signal,onUpdate,execute){
    const owner=this.executionOwners.get(String(toolCallId))||{},state={toolCallId,name,label,appId,operation,risk:'high',params:structuredClone(params),phase:'approval',approvalMessage,sessionId:sessionId||owner.sessionId||'',turnId:turnId||owner.turnId||'',agentId:agentId||owner.agentId||'',agentName:agentName||owner.agentName||'',startedAt:Date.now()};
    const onAbort=()=>{if(['running','approval'].includes(state.phase)){state.phase='cancelled';state.finishedAt=Date.now();this.#setExecution(state)}};
    signal?.addEventListener('abort',onAbort,{once:true});this.#setExecution(state);onUpdate?.(toolResult('Waiting for user approval.',state));
    const approved=await this.#requestApproval(state,signal);
    if(!approved){signal?.removeEventListener('abort',onAbort);if(signal?.aborted){onAbort();throw new Error('System action cancelled.')}state.phase='denied';state.finishedAt=Date.now();this.#setExecution(state);return{approved:false,state:structuredClone(state)}}
    if(signal?.aborted){signal.removeEventListener('abort',onAbort);onAbort();throw new Error('System action cancelled.')}
    try{state.phase='running';this.#setExecution(state);onUpdate?.(toolResult(`Running ${label}…`,state));const value=await execute();state.phase='completed';state.finishedAt=Date.now();state.result=value;this.#setExecution(state);return{approved:true,state:structuredClone(state),value}}
    catch(error){state.phase=signal?.aborted?'cancelled':'failed';state.finishedAt=Date.now();state.error=error.message||String(error);this.#setExecution(state);throw error}
    finally{signal?.removeEventListener('abort',onAbort)}
  }
  apps() {
    const grouped = new Map();
    for (const tool of this.definitions.values()) {
      const app = this.registry.get(tool.appId);
      if (!app) continue;
      const entry = grouped.get(app.id) || { id: app.id, title: app.title, icon: app.icon, color: app.color, count: 0, risks: new Set() };
      entry.count++; entry.risks.add(tool.risk); grouped.set(app.id, entry);
    }
    return [...grouped.values()].map(item => ({ ...item, risks: [...item.risks] }));
  }

  agentTools(owner={}) {
    if(typeof owner==='string')owner={sessionId:owner};
    return this.apps().map(app => {
      const definitions=[...this.definitions.values()].filter(definition=>definition.appId===app.id);
      const properties={type:Type.String({enum:definitions.map(definition=>definition.operation),description:`Operation to perform: ${definitions.map(definition=>definition.operation).join(', ')}`})};
      for(const definition of definitions)for(const [key,schema] of Object.entries(definition.parameters.properties||{}))if(!properties[key])properties[key]=Type.Optional(schema);
      const name=`future_${app.id}`;
      return {
      name,
      label: `${this.i18n.t(app.title)} tool`,
      description: `Use the Future ${this.i18n.t(app.title)} app. Select one operation with type: ${definitions.map(definition=>definition.operation).join(', ')}.`,
      parameters: Type.Object(properties,{additionalProperties:false}),
      executionMode: definitions.some(definition=>definition.risk==='high')?'sequential':'parallel',
      execute: async (toolCallId, input, signal, onUpdate) => {
        const {type,...rawParams}=input,definition=definitions.find(item=>item.operation===type);
        if(!definition)throw new Error(`Unsupported ${app.id} operation: ${type}`);
        const params=validateToolArguments({name:definition.name,parameters:definition.parameters},{id:toolCallId,name:definition.name,arguments:rawParams});
        const state = { toolCallId, name, definitionName:definition.name, label:definition.label, appId: definition.appId, operation: definition.operation, risk: definition.risk, taskTracking:definition.taskTracking||'track', params: structuredClone(params), sessionId:String(owner.sessionId||''),turnId:String(owner.getTurnId?.()||owner.turnId||''),agentId:String(owner.agentId||''),agentName:String(owner.agentName||''),phase: 'running', startedAt: Date.now() };
        const onAbort=()=>{if(state.phase==='running'||state.phase==='approval'){state.phase='cancelled';state.finishedAt=Date.now();this.#setExecution(state)}};
        signal?.addEventListener('abort',onAbort,{once:true});
        this.#setExecution(state); onUpdate?.(toolResult(`Preparing ${definition.label}…`, state));
        if (definition.risk === 'high') {
          state.phase = 'approval';state.approvalMessage=definition.approval(params); this.#setExecution(state); onUpdate?.(toolResult('Waiting for user approval.', state));
          const approved = await this.#requestApproval(state,signal);
          if (!approved) { signal?.removeEventListener('abort',onAbort);if(signal?.aborted){onAbort();throw new Error('System action cancelled.');}state.phase = 'denied'; state.finishedAt = Date.now(); this.#setExecution(state); return toolResult('The user denied this system action.', state); }
        }
        if (signal?.aborted) {signal.removeEventListener('abort',onAbort);onAbort();throw new Error('System action cancelled.');}
        try {
          state.phase = 'running'; this.#setExecution(state);
          const result = await definition.execute(params, signal);
          state.phase = 'completed'; state.finishedAt = Date.now(); state.result = result; this.#setExecution(state);
          if(definition.mutates){const task=this.systemTasks?.snapshot().tasks.find(item=>item.sessionId===state.sessionId&&(!state.turnId||item.turnId===state.turnId));this.operationHistory?.record({definitionName:definition.name,toolCallId:state.toolCallId,appId:definition.appId,operation:definition.operation,label:definition.label,params:auditValue(params),result:definition.undo?result:auditValue(result),taskId:task?.id||'',taskTitle:task?.title||'',taskContent:task?.taskContent||'',sessionId:state.sessionId,turnId:state.turnId,agentId:state.agentId,agentName:state.agentName,source:task?.origin==='automation'?'automation':'agent',undoable:Boolean(definition.undo)})}
          return toolResult(definition.success(result, params), state);
        } catch (error) {
          state.phase = signal?.aborted?'cancelled':'failed'; state.finishedAt = Date.now(); state.error = error.message || String(error); this.#setExecution(state);
          throw error;
        } finally { signal?.removeEventListener('abort',onAbort); }
      },
    }});
  }

  #setExecution(state) {
    this.executions.set(state.toolCallId, structuredClone(state));
    this.kernel?.bus.emit('capability:execution', structuredClone(state));
  }

  #requestApproval(state, signal) {
    return new Promise(resolve=>{
      const finish=value=>{signal?.removeEventListener('abort',abort);if(this.approvals.get(state.toolCallId)?.resolve===finish)this.approvals.delete(state.toolCallId);resolve(value)};
      const abort=()=>finish(false);
      this.approvals.set(state.toolCallId,{resolve:finish});
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
    });
  }

  #register(definition) {
    this.definitions.set(definition.name, {
      risk: 'safe',
      approval: params => `${definition.label}\n\n${text(params)}`,
      success: result => typeof result === 'string' ? result : JSON.stringify(result),
      ...definition,
    });
    if(definition.undo)this.operationHistory?.register(definition.name,definition.undo);
  }

  #registerOpenApp(app) {
    if(!app||app.id==='ai')return;
    this.#register({
      name:`${app.id}_open_app`,
      appId:app.id,
      operation:'open',
      label:`Open ${this.i18n.t(app.title)}`,
      description:`Open the real Future ${this.i18n.t(app.title)} application in the Agent Activity workspace. Use this when the user asks to open, show, or work directly in the application.`,
      parameters:Type.Object({path:Type.Optional(Type.String({description:'Optional Future file or folder path the app should open'}))},{additionalProperties:false}),
      execute:async({path})=>{
        const detail={appId:app.id,path:String(path||'')};
        this.kernel?.bus.emit('agent:open-app',detail);
        return detail;
      },
      success:()=>`Opened ${this.i18n.t(app.title)} in the Agent Activity workspace.`,
    });
  }

  #registerBuiltins() {
    const object = properties => Type.Object(properties, { additionalProperties: false });
    const optionalString = description => Type.Optional(Type.String({ description }));

    this.#register({ name:'calendar_create_event',appId:'calendar',operation:'create_event',mutates:true,label:'Create calendar event',description:'Create an event in the Future Calendar. Use local ISO date-time values such as 2026-08-05T20:00. Calendar alerts appear as system notifications.',parameters:object({title:Type.String(),start:Type.String(),end:optionalString('End local date-time; defaults to one hour after start'),calendarId:optionalString('personal or work'),location:optionalString('Location'),notes:optionalString('Notes'),allDay:Type.Optional(Type.Boolean()),alert:Type.Optional(Type.Union([Type.Literal('none'),Type.Literal('atTime'),Type.Literal('5m'),Type.Literal('15m'),Type.Literal('1h'),Type.Literal('1d')]))}),execute:async params=>{const state=migrateCalendar(await this.userdata.load('calendar',null)),start=parseLocal(params.start),end=params.end?parseLocal(params.end):new Date(start.getTime()+3600000),event={id:crypto.randomUUID(),title:safeName(params.title),calendarId:params.calendarId||'personal',start:localDateTime(start),end:localDateTime(end),allDay:!!params.allDay,location:safeName(params.location),notes:String(params.notes||''),url:'',attendees:'',repeat:'none',alert:params.alert||'15m'};state.events.push(event);await this.userdata.save('calendar',state);return event},undo:async event=>{const state=migrateCalendar(await this.userdata.load('calendar',null));state.events=state.events.filter(item=>item.id!==event.id);await this.userdata.save('calendar',state);return event},success:event=>`Created “${event.title}” for ${event.start}.` });
    this.#register({ name:'calendar_list_events',appId:'calendar',operation:'list_events',label:'List calendar events',description:'List Future calendar events, optionally filtered by YYYY-MM-DD.',parameters:object({date:optionalString('Date in YYYY-MM-DD')}),execute:async({date})=>{const state=migrateCalendar(await this.userdata.load('calendar',null));return state.events.filter(event=>!date||event.start.startsWith(date)).slice(0,50)},success:events=>events.length?JSON.stringify(events):'No matching calendar events.' });
    this.#register({ name:'calendar_delete_event',appId:'calendar',operation:'delete_event',risk:'high',mutates:true,label:'Delete calendar event',description:'Delete a calendar event by its id. Requires user approval.',parameters:object({eventId:Type.String(),title:optionalString('Known event title')}),approval:params=>`Delete the calendar event “${params.title||params.eventId}”?`,execute:async({eventId})=>{const state=migrateCalendar(await this.userdata.load('calendar',null)),event=state.events.find(item=>item.id===eventId);if(!event)throw new Error('Calendar event not found.');state.events=state.events.filter(item=>item.id!==eventId);await this.userdata.save('calendar',state);return event},undo:async event=>{const state=migrateCalendar(await this.userdata.load('calendar',null));if(!state.events.some(item=>item.id===event.id))state.events.push(event);await this.userdata.save('calendar',state);return event},success:event=>`Deleted “${event.title}”.` });

    this.#register({ name:'reminders_create',appId:'reminders',operation:'create',mutates:true,label:'Create reminder',description:'Create a Future reminder. A reminder with a due date produces a system notification at its due time.',parameters:object({title:Type.String(),due:optionalString('Optional YYYY-MM-DD due date'),dueTime:optionalString('Optional local time in HH:MM; defaults to 09:00 when due is set'),priority:Type.Optional(Type.Boolean()),notify:Type.Optional(Type.Boolean())}),execute:async params=>{const items=await this.userdata.load('reminders',[]),item={id:crypto.randomUUID(),title:safeName(params.title),done:false,due:params.due||'',dueTime:params.due?params.dueTime||'09:00':'',notify:params.notify!==false&&!!params.due,priority:!!params.priority,createdAt:Date.now()};items.push(item);await this.userdata.save('reminders',items);return item},undo:async item=>{const items=await this.userdata.load('reminders',[]);await this.userdata.save('reminders',items.filter(entry=>entry.id!==item.id));return item},success:item=>`Created reminder “${item.title}”.` });
    this.#register({ name:'reminders_list',appId:'reminders',operation:'list',label:'List reminders',description:'List reminders, optionally including completed items.',parameters:object({includeCompleted:Type.Optional(Type.Boolean())}),execute:async({includeCompleted})=>(await this.userdata.load('reminders',[])).filter(item=>includeCompleted||!item.done).slice(0,50),success:items=>items.length?JSON.stringify(items):'No matching reminders.' });
    this.#register({ name:'reminders_complete',appId:'reminders',operation:'complete',mutates:true,label:'Complete reminder',description:'Mark a reminder as completed.',parameters:object({reminderId:Type.String()}),execute:async({reminderId})=>{const items=await this.userdata.load('reminders',[]),item=items.find(entry=>entry.id===reminderId);if(!item)throw new Error('Reminder not found.');const previousDone=!!item.done;item.done=true;await this.userdata.save('reminders',items);return{item:{...item},previousDone}},undo:async result=>{const items=await this.userdata.load('reminders',[]),item=items.find(entry=>entry.id===result.item.id);if(!item)throw new Error('Reminder not found.');item.done=result.previousDone;await this.userdata.save('reminders',items);return item},success:result=>`Completed reminder “${result.item.title}”.` });

    this.#register({ name:'notes_create',appId:'notes',operation:'create',mutates:true,label:'Create note',description:'Create a local note in Future Notes.',parameters:object({title:Type.String(),content:Type.String(),pinned:Type.Optional(Type.Boolean())}),execute:async params=>{const notes=await this.userdata.load('notes',[]),note={id:crypto.randomUUID(),title:safeName(params.title),content:String(params.content),pinned:!!params.pinned,updatedAt:Date.now()};notes.unshift(note);await this.userdata.save('notes',notes);return note},undo:async note=>{const notes=await this.userdata.load('notes',[]);await this.userdata.save('notes',notes.filter(item=>item.id!==note.id));return note},success:note=>`Created note “${note.title}”.` });
    this.#register({ name:'notes_search',appId:'notes',operation:'search',label:'Search notes',description:'Search note titles and contents.',parameters:object({query:Type.String()}),execute:async({query})=>{const needle=query.toLowerCase();return(await this.userdata.load('notes',[])).filter(note=>`${note.title} ${note.content}`.toLowerCase().includes(needle)).slice(0,20)},success:notes=>notes.length?JSON.stringify(notes):'No matching notes.' });
    this.#register({ name:'notes_delete',appId:'notes',operation:'delete',risk:'high',mutates:true,label:'Delete note',description:'Delete a note by id. Requires user approval.',parameters:object({noteId:Type.String(),title:optionalString('Known note title')}),approval:params=>`Delete the note “${params.title||params.noteId}”?`,execute:async({noteId})=>{const notes=await this.userdata.load('notes',[]),note=notes.find(item=>item.id===noteId);if(!note)throw new Error('Note not found.');await this.userdata.save('notes',notes.filter(item=>item.id!==noteId));return note},undo:async note=>{const notes=await this.userdata.load('notes',[]);if(!notes.some(item=>item.id===note.id))notes.unshift(note);await this.userdata.save('notes',notes);return note},success:note=>`Deleted note “${note.title}”.` });

    this.#register({ name:'contacts_create',appId:'contacts',operation:'create',mutates:true,label:'Create contact',description:'Create a contact on this Future computer.',parameters:object({name:Type.String(),email:optionalString('Email address'),phone:optionalString('Phone number')}),execute:async params=>{const contacts=await this.userdata.load('contacts',[]),contact={id:crypto.randomUUID(),name:safeName(params.name),email:safeName(params.email),phone:safeName(params.phone),favorite:false};contacts.push(contact);await this.userdata.save('contacts',contacts);return contact},undo:async contact=>{const contacts=await this.userdata.load('contacts',[]);await this.userdata.save('contacts',contacts.filter(item=>item.id!==contact.id));return contact},success:contact=>`Created contact “${contact.name}”.` });
    this.#register({ name:'contacts_search',appId:'contacts',operation:'search',label:'Search contacts',description:'Search contacts by name, email, or phone.',parameters:object({query:Type.String()}),execute:async({query})=>{const needle=query.toLowerCase();return(await this.userdata.load('contacts',[])).filter(item=>`${item.name} ${item.email} ${item.phone}`.toLowerCase().includes(needle)).slice(0,30)},success:contacts=>contacts.length?JSON.stringify(contacts):'No matching contacts.' });

    this.#register({ name:'files_list',appId:'files',operation:'list',label:'List files',description:'List files and folders in /home/future or /mnt/future.',parameters:object({path:Type.String()}),execute:async({path})=>this.system.list(futurePath(path),{fresh:true,priority:true,timeout:20000}),success:items=>JSON.stringify(items) });
    this.#register({ name:'files_read',appId:'files',operation:'read_file',label:'Read file',description:'Read a UTF-8 text file from the Future filesystem.',parameters:object({path:Type.String()}),execute:async({path})=>{path=futurePath(path);const content=await this.system.read(path,{priority:true});return{path,content:String(content).slice(0,12000),truncated:String(content).length>12000}},success:result=>`${result.content}${result.truncated?'\n\n[Output truncated]':''}` });
    this.#register({ name:'files_write',appId:'files',operation:'write_file',risk:'high',mutates:true,label:'Write file',description:'Create or replace a UTF-8 text file in the Future filesystem. Requires approval because an existing file may be overwritten.',parameters:object({path:Type.String(),content:Type.String()}),approval:params=>`Create or replace “${params.path}”?`,execute:async({path,content})=>{path=mutableFuturePath(path);await this.system.writeChunked(path,content,{priority:true});return{path,bytes:new TextEncoder().encode(content).length}},success:result=>`Saved ${result.path} (${result.bytes} bytes).` });
    this.#register({ name:'files_create_folder',appId:'files',operation:'create_folder',mutates:true,label:'Create folder',description:'Create a folder inside /home/future or /mnt/future.',parameters:object({path:Type.String()}),execute:async({path})=>{path=mutableFuturePath(path);await this.system.mkdir(path,{priority:true});return{path}},undo:async result=>this.system.trash(result.path,{priority:true}),success:result=>`Created folder ${result.path}.` });
    this.#register({ name:'files_rename',appId:'files',operation:'rename',mutates:true,label:'Rename item',description:'Rename a file or folder without moving it to another directory.',parameters:object({path:Type.String(),name:Type.String()}),execute:async({path,name})=>{path=mutableFuturePath(path);const target=await this.system.rename(path,futureName(name),{priority:true});return{path:target,previousPath:path}},undo:async result=>this.system.rename(result.path,result.previousPath.split('/').at(-1),{priority:true}),success:result=>`Renamed the item to ${result.path}.` });
    this.#register({ name:'files_copy',appId:'files',operation:'copy',mutates:true,label:'Duplicate item',description:'Duplicate a file or folder beside the original and choose a non-conflicting name.',parameters:object({path:Type.String()}),execute:async({path})=>({path:await this.system.copy(mutableFuturePath(path),{priority:true})}),undo:async result=>this.system.trash(result.path,{priority:true}),success:result=>`Created ${result.path}.` });
    this.#register({ name:'files_move',appId:'files',operation:'move',mutates:true,label:'Move item',description:'Move a file or folder into another Future directory.',parameters:object({path:Type.String(),destination:Type.String()}),execute:async({path,destination})=>({path:await this.system.move(mutableFuturePath(path),futurePath(destination),{priority:true}),previousPath:path}),undo:async result=>this.system.move(result.path,result.previousPath.split('/').slice(0,-1).join('/')||'/',{priority:true}),success:result=>`Moved the item to ${result.path}.` });
    this.#register({ name:'files_delete',appId:'files',operation:'delete',risk:'high',mutates:true,label:'Delete item',description:'Delete a file or folder by moving it to the Future Trash. Requires user approval.',parameters:object({path:Type.String()}),approval:params=>`Move “${params.path}” to Trash?`,execute:async({path})=>({path:await this.system.trash(mutableFuturePath(path),{priority:true})}),undo:async result=>this.system.restoreTrash(result.path),success:result=>`Moved the item to ${result.path}.` });
    this.#register({ name:'textedit_create_document',appId:'textedit',operation:'create_document',mutates:true,label:'Create text document',description:'Create or replace a text document in Desktop or Documents.',parameters:object({path:Type.String(),content:Type.String()}),execute:async({path,content})=>{if(!/^\/home\/future\/(Desktop|Documents)\//.test(path))throw new Error('Documents must be saved in Desktop or Documents.');await this.system.writeChunked(path,content);return{path}},success:result=>`Saved document ${result.path}.` });
    this.#register({ name:'preview_read_text',appId:'preview',operation:'read_text',label:'Read text file',description:'Read a text file from the Future Linux filesystem for inspection.',parameters:object({path:Type.String()}),execute:async({path})=>{if(!path.startsWith('/'))throw new Error('An absolute path is required.');const content=await this.system.read(path);return{path,content:String(content).slice(0,12000),truncated:String(content).length>12000}},success:result=>`${result.content}${result.truncated?'\n\n[Output truncated]':''}` });
    this.#register({ name:'photos_list',appId:'photos',operation:'list',label:'List photos',description:'List images in the Future Pictures folder.',parameters:object({}),execute:async()=>this.system.list('/home/future/Pictures',{fresh:true}),success:items=>items.length?JSON.stringify(items):'The photo library is empty.' });

    this.#register({ name:'weather_current',appId:'weather',operation:'current',label:'Read weather',description:'Read weather for any requested city or place. Always translate the requested location to its English place name before calling this tool. Omit location to use the location configured in Future Weather.',parameters:object({location:optionalString('English city or place name only, such as Shanghai, London, or San Francisco'),refresh:Type.Optional(Type.Boolean())}),execute:async({location,refresh},signal)=>{if(location)return this.weather.lookup(location,signal);if(refresh)await this.weather.refresh(true,{signal,timeout:15000});return this.weather.snapshot()},success:result=>JSON.stringify(result) });
    this.#register({ name:'clock_current_time',appId:'clock',operation:'current_time',label:'Read current time',description:'Read the current local date, time, and timezone.',parameters:object({}),execute:async()=>({iso:new Date().toISOString(),local:new Date().toString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}),success:result=>JSON.stringify(result) });
    this.#register({ name:'monitor_read_metrics',appId:'monitor',operation:'read_metrics',label:'Read system metrics',description:'Read the latest Linux memory, load, and uptime sample without blocking the conversation.',parameters:object({refresh:Type.Optional(Type.Boolean())}),execute:async({refresh})=>{const sample=this.metrics.snapshot();if(refresh||!sample.ready)this.metrics.refresh().catch(()=>{});return sample},success:result=>JSON.stringify(result) });
    this.#register({ name:'disk_list_volumes',appId:'diskutility',operation:'list_volumes',label:'List mounted volumes',description:'List mounted Future Linux filesystems.',parameters:object({}),execute:async()=>({output:(await this.system.exec('df -kP',12000)).output}),success:result=>result.output });

    this.#register({ name:'settings_update',appId:'settings',operation:'update',mutates:true,label:'Change system setting',description:'Apply an installed system theme by id, or change an allowed Future locale.',parameters:object({key:Type.Union([Type.Literal('theme'),Type.Literal('locale')]),value:Type.String()}),execute:async({key,value})=>{const previous=key==='theme'?this.themeRuntime?.snapshot()?.id:this.settings.get(key);if(key==='theme'){if(!this.themeRuntime?.get(value))throw new Error(`Theme is not installed: ${value}`);this.themeRuntime.apply(value)}else{if(!['en','zh'].includes(value))throw new Error(`Unsupported locale value.`);this.settings.set(key,value)}return{key,value,previous}},undo:async result=>{if(result.key==='theme')this.themeRuntime.apply(result.previous);else this.settings.set(result.key,result.previous);return result},success:result=>`Changed ${result.key} to ${result.value}.` });
    this.#register({ name:'terminal_run_command',appId:'terminal',operation:'run_command',risk:'high',mutates:true,label:'Run terminal command',description:'Run a finite, non-interactive command inside the Future Linux guest from /home/future. Always requires explicit user approval.',parameters:object({command:Type.String({description:'A finite, non-interactive shell command. Add command flags that disable prompts and bound continuous output.'}),reason:optionalString('Why this command is required')}),approval:params=>`Allow Future AI to run this command?\n\n${params.command}${params.reason?`\n\nReason: ${params.reason}`:''}`,execute:async({command},signal)=>{const result=await this.system.runAgentCommand(command,60000,signal);if(result.code!==0)throw new Error(result.output||`Command exited with status ${result.code}.`);return{exitCode:result.code,output:result.output.slice(0,12000)}},success:result=>`Command exited with status ${result.exitCode}.\n${result.output}` });
    this.#register({ name:'machine_restart',appId:'machine',operation:'restart',risk:'high',mutates:true,label:'Restart virtual computer',description:'Restart the Future Linux virtual computer. Requires user approval.',parameters:object({reason:optionalString('Reason for restart')}),approval:params=>`Restart the Future Linux computer?${params.reason?`\n\n${params.reason}`:''}`,execute:async()=>{await this.machine.restart();return{restarted:true}},success:()=> 'The Future Linux computer is restarting.' });
    this.#register({ name:'trash_empty',appId:'trash',operation:'empty',risk:'high',mutates:true,label:'Empty Trash',description:'Permanently delete every item in Trash. Requires user approval.',parameters:object({}),approval:()=> 'Permanently delete every item in Trash? This cannot be undone.',execute:async()=>{await this.system.emptyTrash();return{emptied:true}},success:()=> 'Trash was emptied.' });

    this.#register({ name:'calculator_calculate',appId:'calculator',operation:'calculate',label:'Calculate expression',description:'Evaluate a basic arithmetic expression containing numbers and + - * / % parentheses.',parameters:object({expression:Type.String()}),execute:async({expression})=>{if(!/^[\d\s+\-*/%().]+$/.test(expression))throw new Error('Unsupported calculator expression.');const value=Function(`"use strict";return (${expression})`)();if(!Number.isFinite(value))throw new Error('The result is not finite.');return{expression,value}},success:result=>`${result.expression} = ${result.value}` });
    this.#register({ name:'music_list',appId:'music',operation:'list',label:'List local music',description:'List songs imported into the Future Music library.',parameters:object({query:optionalString('Optional song title, artist, or category')}),execute:async({query})=>{await this.music.refresh();const needle=String(query||'').toLowerCase();return this.music.snapshot().tracks.filter(track=>!needle||`${track.title} ${track.artist} ${track.category}`.toLowerCase().includes(needle)).slice(0,100)},success:tracks=>tracks.length?JSON.stringify(tracks):'No matching local songs.' });
    this.#register({ name:'music_play',appId:'music',operation:'play',label:'Play local music',description:'Play a local song by title or path in the real Future Music player.',parameters:object({song:Type.String({description:'Song title, partial title, or Future path'})}),execute:async({song})=>{if(!this.music.snapshot().tracks.length)await this.music.refresh();return this.music.play(song)},success:track=>`Now playing “${track.title}” by ${track.artist}.` });
    this.#register({ name:'music_pause',appId:'music',operation:'pause',label:'Pause music',description:'Pause the song currently playing in Future Music.',parameters:object({}),execute:async()=>{this.music.pause();return this.music.snapshot().current},success:track=>track?`Paused “${track.title}”.`:'Music is paused.' });

    this.#register({name:'browser_new_tab',appId:'browser',operation:'new_tab',label:'Open browser tab',description:'Open a URL or search query in a new visible Future Browser tab. The Browser Activity view opens automatically.',parameters:object({url:Type.String()}),execute:async({url},signal)=>{let tab=this.browser.newTab(url);this.kernel?.bus.emit('agent:open-app',{appId:'browser',operation:'new_tab',url:tab.url});const remote=await this.browserAutomation.navigate(tab.url,signal);if(remote.url&&remote.url!==tab.url)tab=this.browser.navigate(remote.url,{replace:true});return{tab,remote}},success:result=>`Opened ${result.tab.url} in a new Browser tab.`});
    this.#register({name:'browser_navigate',appId:'browser',operation:'navigate',label:'Navigate browser',description:'Navigate the shared visible Future Chromium view to an HTTP or HTTPS URL. The Browser Activity view opens automatically.',parameters:object({url:Type.String()}),execute:async({url},signal)=>{let tab=this.browser.navigate(url);this.kernel?.bus.emit('agent:open-app',{appId:'browser',operation:'navigate',url:tab.url});const remote=await this.browserAutomation.navigate(tab.url,signal);if(remote.url&&remote.url!==tab.url)tab=this.browser.navigate(remote.url,{replace:true});return{tab,remote}},success:result=>`Navigated Browser to ${result.tab.url}.`});
    this.#register({name:'browser_current_page',appId:'browser',operation:'current_page',label:'Read current browser page',description:'Read the active Future Browser tab URL and metadata. This does not extract cross-origin page content.',parameters:object({}),execute:async()=>this.browser.active(),success:tab=>tab?JSON.stringify(tab):'No active Browser tab.'});
    this.#register({name:'browser_list_tabs',appId:'browser',operation:'list_tabs',label:'List browser tabs',description:'List the tabs currently open in Future Browser.',parameters:object({}),execute:async()=>this.browser.snapshot().tabs,success:tabs=>JSON.stringify(tabs)});
    this.#register({name:'browser_back',appId:'browser',operation:'back',label:'Browser back',description:'Navigate the shared visible Future Browser view backward in history.',parameters:object({}),execute:async(params,signal)=>{let tab=this.browser.back();this.kernel?.bus.emit('agent:open-app',{appId:'browser',operation:'back',url:tab.url});const remote=await this.browserAutomation.history('back',signal);if(remote.url&&remote.url!==tab.url)tab=this.browser.navigate(remote.url,{replace:true});return{tab,remote}},success:result=>`Navigated back to ${result.tab.url}.`});
    this.#register({name:'browser_forward',appId:'browser',operation:'forward',label:'Browser forward',description:'Navigate the shared visible Future Browser view forward in history.',parameters:object({}),execute:async(params,signal)=>{let tab=this.browser.forward();this.kernel?.bus.emit('agent:open-app',{appId:'browser',operation:'forward',url:tab.url});const remote=await this.browserAutomation.history('forward',signal);if(remote.url&&remote.url!==tab.url)tab=this.browser.navigate(remote.url,{replace:true});return{tab,remote}},success:result=>`Navigated forward to ${result.tab.url}.`});
    this.#register({name:'browser_automation_status',appId:'browser',operation:'automation_status',label:'Check browser automation',description:'Check whether the host-side Future backend and Browser Use MCP are available. This starts Browser Use only when explicitly requested.',parameters:object({connect:Type.Optional(Type.Boolean())}),execute:async({connect},signal)=>this.browserAutomation.capabilities({connect:!!connect,signal}),success:result=>JSON.stringify(result)});
    this.#register({name:'browser_inspect_page',appId:'browser',operation:'inspect_page',label:'Inspect browser page',description:'Read the current Browser Use page state and its indexed interactive elements.',parameters:object({includeScreenshot:Type.Optional(Type.Boolean())}),execute:async({includeScreenshot},signal)=>this.browserAutomation.execute('get_state',{include_screenshot:!!includeScreenshot},signal),success:result=>JSON.stringify(result.result)});
    this.#register({name:'browser_extract_content',appId:'browser',operation:'extract_content',label:'Read browser page content',description:'Extract structured content from the current page in the Browser Use session.',parameters:object({}),execute:async(params,signal)=>this.browserAutomation.execute('extract_content',{},signal),success:result=>JSON.stringify(result.result)});
    this.#register({name:'browser_click',appId:'browser',operation:'click',risk:'high',mutates:true,label:'Click browser element',description:'Click an indexed element in the Browser Use page. Requires approval because a click may submit data or change an external service.',parameters:object({index:Type.Number({minimum:0}),reason:optionalString('Why this element must be clicked')}),approval:params=>`Allow Future AI to click browser element ${params.index}?${params.reason?`\n\n${params.reason}`:''}`,execute:async({index},signal)=>this.browserAutomation.execute('click',{index},signal),success:(_,params)=>`Clicked browser element ${params.index}.`});
    this.#register({name:'browser_type',appId:'browser',operation:'type',risk:'high',mutates:true,label:'Type into browser',description:'Type text into an indexed Browser Use field. Requires approval because text is transmitted to the displayed website.',parameters:object({index:Type.Number({minimum:0}),text:Type.String(),reason:optionalString('Why this text must be entered')}),approval:params=>`Allow Future AI to type into browser element ${params.index}?\n\n${params.text}`,execute:async({index,text},signal)=>this.browserAutomation.execute('type',{index,text},signal),success:()=>`Entered text in the browser field.`});
    this.#register({name:'browser_scroll',appId:'browser',operation:'scroll',label:'Scroll browser page',description:'Scroll the current Browser Use page up or down.',parameters:object({direction:Type.Union([Type.Literal('up'),Type.Literal('down')]),amount:Type.Optional(Type.Number({minimum:1,maximum:10000}))}),execute:async({direction,amount},signal)=>this.browserAutomation.execute('scroll',{direction,...(amount?{amount}:{})},signal),success:(_,params)=>`Scrolled the browser ${params.direction}.`});

    if(this.automations){
      const triggerType=Type.Union(['daily','interval','app_opened','file_changed','network_online','memory_above'].map(value=>Type.Literal(value)));
      this.#register({name:'automations_list',appId:'tasks',operation:'list_automations',taskTracking:'ignore',label:'List automations',description:'List system automation rules and their current state.',parameters:object({}),execute:async()=>this.automations.list(),success:rules=>rules.length?JSON.stringify(rules):'No automations are configured.'});
      this.#register({name:'automations_create',appId:'tasks',operation:'create_automation',taskTracking:'ignore',mutates:true,label:'Create automation',description:'Create a Future system automation that starts a background Agent task when a system event occurs.',parameters:object({name:Type.String(),triggerType,time:optionalString('HH:MM for daily automation'),intervalMinutes:Type.Optional(Type.Number({minimum:1})),appId:optionalString('App id for app_opened'),path:optionalString('Path prefix for file_changed'),threshold:Type.Optional(Type.Number({minimum:1,maximum:100})),prompt:Type.String()}),execute:async params=>this.automations.create({name:params.name,trigger:{type:params.triggerType,time:params.time,intervalMinutes:params.intervalMinutes,appId:params.appId,path:params.path,threshold:params.threshold},action:{type:'agent',prompt:params.prompt}}),undo:async rule=>this.automations.remove(rule.id),success:rule=>`Created automation “${rule.name}”.`});
      this.#register({name:'automations_set_enabled',appId:'tasks',operation:'set_automation_enabled',taskTracking:'ignore',mutates:true,label:'Enable or disable automation',description:'Enable or disable an existing system automation.',parameters:object({automationId:Type.String(),enabled:Type.Boolean()}),execute:async({automationId,enabled})=>{const previous=this.automations.get(automationId);if(!previous)throw new Error('Automation not found.');const rule=this.automations.setEnabled(automationId,enabled);return{rule,previousEnabled:previous.enabled}},undo:async result=>this.automations.setEnabled(result.rule.id,result.previousEnabled),success:result=>`${result.rule.enabled?'Enabled':'Disabled'} “${result.rule.name}”.`});
      this.#register({name:'automations_run',appId:'tasks',operation:'run_automation',taskTracking:'ignore',label:'Run automation now',description:'Run an existing system automation immediately.',parameters:object({automationId:Type.String()}),execute:async({automationId})=>this.automations.run(automationId,{reason:'agent'}),success:()=>`Started the automation.`});
      this.#register({name:'automations_delete',appId:'tasks',operation:'delete_automation',taskTracking:'ignore',risk:'high',mutates:true,label:'Delete automation',description:'Delete an automation rule. Requires approval.',parameters:object({automationId:Type.String(),name:optionalString('Known automation name')}),approval:params=>`Delete the automation “${params.name||params.automationId}”?`,execute:async({automationId})=>{const rule=this.automations.get(automationId);if(!rule)throw new Error('Automation not found.');this.automations.remove(automationId);return rule},undo:async rule=>this.automations.restore(rule),success:rule=>`Deleted automation “${rule.name}”.`});
    }
    if(this.systemTasks){
      this.#register({name:'system_tasks_list',appId:'tasks',operation:'list_tasks',taskTracking:'ignore',label:'List system tasks',description:'List current and recent background Agent and automation tasks. This read-only query is never itself recorded as a task.',parameters:object({}),execute:async()=>this.systemTasks.snapshot().tasks.slice(0,50),success:tasks=>tasks.length?JSON.stringify(tasks):'No system tasks.'});
      this.#register({name:'system_tasks_cancel',appId:'tasks',operation:'cancel_task',taskTracking:'ignore',risk:'high',label:'Cancel system task',description:'Stop a running system task. Requires approval.',parameters:object({taskId:Type.String()}),approval:params=>`Stop system task ${params.taskId}?`,execute:async({taskId})=>({taskId,cancelled:await this.systemTasks.cancel(taskId)}),success:result=>result.cancelled?'Stopped the task.':'The task was already finished.'});
    }
    if(this.operationHistory){
      this.#register({name:'operations_list',appId:'tasks',operation:'list_operations',taskTracking:'ignore',label:'List Agent operations',description:'List recent system changes performed by Agents and automations.',parameters:object({}),execute:async()=>this.operationHistory.snapshot().records.slice(0,50),success:records=>records.length?JSON.stringify(records):'No recorded system changes.'});
      this.#register({name:'operations_undo',appId:'tasks',operation:'undo_operation',taskTracking:'ignore',risk:'high',label:'Undo Agent operation',description:'Undo a reversible Agent system change. Requires approval.',parameters:object({operationId:Type.String()}),approval:params=>`Undo Agent operation ${params.operationId}?`,execute:async({operationId})=>this.operationHistory.undo(operationId),success:record=>`Undid “${record.label}”.`});
    }

    for(const app of this.registry.list())this.#registerOpenApp(app);
  }
}
