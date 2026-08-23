import { Type, validateToolArguments } from '@earendil-works/pi-ai';
import { migrate as migrateCalendar, localDateTime, parseLocal } from '../apps/calendar/model.js';

const text = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const safeName = value => String(value || '').trim().replace(/[\r\n]/g, ' ');
const toolResult = (message, details) => ({ content: [{ type: 'text', text: message }], details });
const aerisPath = value => {
  const source=String(value||'').trim();
  if(!source.startsWith('/')||source.includes('\0'))throw new Error('An absolute Aeris path is required.');
  const parts=[];
  for(const part of source.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){if(!parts.length)throw new Error('The path leaves the Aeris filesystem.');parts.pop();continue}
    parts.push(part);
  }
  const path=`/${parts.join('/')}`;
  if(path!=='/home/aeris'&&!path.startsWith('/home/aeris/')&&path!=='/mnt/aeris'&&!path.startsWith('/mnt/aeris/'))throw new Error('Files tools can only access /home/aeris or /mnt/aeris.');
  return path;
};
const aerisName = value => {
  const name=safeName(value);
  if(!name||name==='.'||name==='..'||name.includes('/'))throw new Error('A valid file or folder name is required.');
  return name;
};
const mutableAerisPath = value => {
  const path=aerisPath(value);
  if(path==='/home/aeris'||path==='/mnt/aeris')throw new Error('The root Aeris folders cannot be changed.');
  return path;
};

export class SystemToolService {
  constructor({ userdata, system, settings, themeRuntime, weather, metrics, machine, music, browser, browserAutomation, registry, i18n }) {
    Object.assign(this, { userdata, system, settings, themeRuntime, weather, metrics, machine, music, browser, browserAutomation, registry, i18n });
    this.definitions = new Map();
    this.executions = new Map();
    this.approvals = new Map();
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
    const appId=String(name||'').replace(/^aeris_/,'');
    const definitions=[...this.definitions.values()].filter(definition=>definition.appId===appId),app=this.registry.get(appId);
    if(!definitions.length||!app)return null;
    return {name:`aeris_${appId}`,appId,operation:'app_capability',label:`${this.i18n.t(app.title)} tool`,description:definitions.map(definition=>`${definition.operation}: ${definition.description}`).join('\n'),risk:definitions.some(definition=>definition.risk==='high')?'mixed':'safe'};
  }
  execution(id) { return this.executions.get(id) ? structuredClone(this.executions.get(id)) : null; }
  pendingApproval() { const id=[...this.approvals.keys()].at(-1);return id?this.execution(id):null; }
  resolveApproval(id, approved) { const pending=this.approvals.get(id);if(!pending)return false;this.approvals.delete(id);pending.resolve(!!approved);return true; }
  async runProtected({toolCallId,name,label,appId='',operation,params={},approvalMessage},signal,onUpdate,execute){
    const state={toolCallId,name,label,appId,operation,risk:'high',params:structuredClone(params),phase:'approval',approvalMessage,startedAt:Date.now()};
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

  agentTools() {
    return this.apps().map(app => {
      const definitions=[...this.definitions.values()].filter(definition=>definition.appId===app.id);
      const properties={type:Type.String({enum:definitions.map(definition=>definition.operation),description:`Operation to perform: ${definitions.map(definition=>definition.operation).join(', ')}`})};
      for(const definition of definitions)for(const [key,schema] of Object.entries(definition.parameters.properties||{}))if(!properties[key])properties[key]=Type.Optional(schema);
      const name=`aeris_${app.id}`;
      return {
      name,
      label: `${this.i18n.t(app.title)} tool`,
      description: `Use the Aeris ${this.i18n.t(app.title)} app. Select one operation with type: ${definitions.map(definition=>definition.operation).join(', ')}.`,
      parameters: Type.Object(properties,{additionalProperties:false}),
      executionMode: definitions.some(definition=>definition.risk==='high')?'sequential':'parallel',
      execute: async (toolCallId, input, signal, onUpdate) => {
        const {type,...rawParams}=input,definition=definitions.find(item=>item.operation===type);
        if(!definition)throw new Error(`Unsupported ${app.id} operation: ${type}`);
        const params=validateToolArguments({name:definition.name,parameters:definition.parameters},{id:toolCallId,name:definition.name,arguments:rawParams});
        const state = { toolCallId, name, definitionName:definition.name, label:definition.label, appId: definition.appId, operation: definition.operation, risk: definition.risk, params: structuredClone(params), phase: 'running', startedAt: Date.now() };
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
  }

  #registerOpenApp(app) {
    if(!app||app.id==='ai')return;
    this.#register({
      name:`${app.id}_open_app`,
      appId:app.id,
      operation:'open',
      label:`Open ${this.i18n.t(app.title)}`,
      description:`Open the real Aeris ${this.i18n.t(app.title)} application in the Agent Activity workspace. Use this when the user asks to open, show, or work directly in the application.`,
      parameters:Type.Object({path:Type.Optional(Type.String({description:'Optional Aeris file or folder path the app should open'}))},{additionalProperties:false}),
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

    this.#register({ name:'calendar_create_event',appId:'calendar',operation:'create_event',label:'Create calendar event',description:'Create an event in the Aeris Calendar. Use local ISO date-time values such as 2026-08-05T20:00. Calendar alerts appear as system notifications.',parameters:object({title:Type.String(),start:Type.String(),end:optionalString('End local date-time; defaults to one hour after start'),calendarId:optionalString('personal or work'),location:optionalString('Location'),notes:optionalString('Notes'),allDay:Type.Optional(Type.Boolean()),alert:Type.Optional(Type.Union([Type.Literal('none'),Type.Literal('atTime'),Type.Literal('5m'),Type.Literal('15m'),Type.Literal('1h'),Type.Literal('1d')]))}),execute:async params=>{const state=migrateCalendar(await this.userdata.load('calendar',null)),start=parseLocal(params.start),end=params.end?parseLocal(params.end):new Date(start.getTime()+3600000),event={id:crypto.randomUUID(),title:safeName(params.title),calendarId:params.calendarId||'personal',start:localDateTime(start),end:localDateTime(end),allDay:!!params.allDay,location:safeName(params.location),notes:String(params.notes||''),url:'',attendees:'',repeat:'none',alert:params.alert||'15m'};state.events.push(event);await this.userdata.save('calendar',state);return event},success:event=>`Created “${event.title}” for ${event.start}.` });
    this.#register({ name:'calendar_list_events',appId:'calendar',operation:'list_events',label:'List calendar events',description:'List Aeris calendar events, optionally filtered by YYYY-MM-DD.',parameters:object({date:optionalString('Date in YYYY-MM-DD')}),execute:async({date})=>{const state=migrateCalendar(await this.userdata.load('calendar',null));return state.events.filter(event=>!date||event.start.startsWith(date)).slice(0,50)},success:events=>events.length?JSON.stringify(events):'No matching calendar events.' });
    this.#register({ name:'calendar_delete_event',appId:'calendar',operation:'delete_event',risk:'high',label:'Delete calendar event',description:'Delete a calendar event by its id. Requires user approval.',parameters:object({eventId:Type.String(),title:optionalString('Known event title')}),approval:params=>`Delete the calendar event “${params.title||params.eventId}”?`,execute:async({eventId})=>{const state=migrateCalendar(await this.userdata.load('calendar',null)),event=state.events.find(item=>item.id===eventId);if(!event)throw new Error('Calendar event not found.');state.events=state.events.filter(item=>item.id!==eventId);await this.userdata.save('calendar',state);return event},success:event=>`Deleted “${event.title}”.` });

    this.#register({ name:'reminders_create',appId:'reminders',operation:'create',label:'Create reminder',description:'Create an Aeris reminder. A reminder with a due date produces a system notification at its due time.',parameters:object({title:Type.String(),due:optionalString('Optional YYYY-MM-DD due date'),dueTime:optionalString('Optional local time in HH:MM; defaults to 09:00 when due is set'),priority:Type.Optional(Type.Boolean()),notify:Type.Optional(Type.Boolean())}),execute:async params=>{const items=await this.userdata.load('reminders',[]),item={id:crypto.randomUUID(),title:safeName(params.title),done:false,due:params.due||'',dueTime:params.due?params.dueTime||'09:00':'',notify:params.notify!==false&&!!params.due,priority:!!params.priority,createdAt:Date.now()};items.push(item);await this.userdata.save('reminders',items);return item},success:item=>`Created reminder “${item.title}”.` });
    this.#register({ name:'reminders_list',appId:'reminders',operation:'list',label:'List reminders',description:'List reminders, optionally including completed items.',parameters:object({includeCompleted:Type.Optional(Type.Boolean())}),execute:async({includeCompleted})=>(await this.userdata.load('reminders',[])).filter(item=>includeCompleted||!item.done).slice(0,50),success:items=>items.length?JSON.stringify(items):'No matching reminders.' });
    this.#register({ name:'reminders_complete',appId:'reminders',operation:'complete',label:'Complete reminder',description:'Mark a reminder as completed.',parameters:object({reminderId:Type.String()}),execute:async({reminderId})=>{const items=await this.userdata.load('reminders',[]),item=items.find(entry=>entry.id===reminderId);if(!item)throw new Error('Reminder not found.');item.done=true;await this.userdata.save('reminders',items);return item},success:item=>`Completed reminder “${item.title}”.` });

    this.#register({ name:'notes_create',appId:'notes',operation:'create',label:'Create note',description:'Create a local note in Aeris Notes.',parameters:object({title:Type.String(),content:Type.String(),pinned:Type.Optional(Type.Boolean())}),execute:async params=>{const notes=await this.userdata.load('notes',[]),note={id:crypto.randomUUID(),title:safeName(params.title),content:String(params.content),pinned:!!params.pinned,updatedAt:Date.now()};notes.unshift(note);await this.userdata.save('notes',notes);return note},success:note=>`Created note “${note.title}”.` });
    this.#register({ name:'notes_search',appId:'notes',operation:'search',label:'Search notes',description:'Search note titles and contents.',parameters:object({query:Type.String()}),execute:async({query})=>{const needle=query.toLowerCase();return(await this.userdata.load('notes',[])).filter(note=>`${note.title} ${note.content}`.toLowerCase().includes(needle)).slice(0,20)},success:notes=>notes.length?JSON.stringify(notes):'No matching notes.' });
    this.#register({ name:'notes_delete',appId:'notes',operation:'delete',risk:'high',label:'Delete note',description:'Delete a note by id. Requires user approval.',parameters:object({noteId:Type.String(),title:optionalString('Known note title')}),approval:params=>`Delete the note “${params.title||params.noteId}”?`,execute:async({noteId})=>{const notes=await this.userdata.load('notes',[]),note=notes.find(item=>item.id===noteId);if(!note)throw new Error('Note not found.');await this.userdata.save('notes',notes.filter(item=>item.id!==noteId));return note},success:note=>`Deleted note “${note.title}”.` });

    this.#register({ name:'contacts_create',appId:'contacts',operation:'create',label:'Create contact',description:'Create a contact on this Aeris computer.',parameters:object({name:Type.String(),email:optionalString('Email address'),phone:optionalString('Phone number')}),execute:async params=>{const contacts=await this.userdata.load('contacts',[]),contact={id:crypto.randomUUID(),name:safeName(params.name),email:safeName(params.email),phone:safeName(params.phone),favorite:false};contacts.push(contact);await this.userdata.save('contacts',contacts);return contact},success:contact=>`Created contact “${contact.name}”.` });
    this.#register({ name:'contacts_search',appId:'contacts',operation:'search',label:'Search contacts',description:'Search contacts by name, email, or phone.',parameters:object({query:Type.String()}),execute:async({query})=>{const needle=query.toLowerCase();return(await this.userdata.load('contacts',[])).filter(item=>`${item.name} ${item.email} ${item.phone}`.toLowerCase().includes(needle)).slice(0,30)},success:contacts=>contacts.length?JSON.stringify(contacts):'No matching contacts.' });

    this.#register({ name:'files_list',appId:'files',operation:'list',label:'List files',description:'List files and folders in /home/aeris or /mnt/aeris.',parameters:object({path:Type.String()}),execute:async({path})=>this.system.list(aerisPath(path),{fresh:true,priority:true,timeout:20000}),success:items=>JSON.stringify(items) });
    this.#register({ name:'files_read',appId:'files',operation:'read_file',label:'Read file',description:'Read a UTF-8 text file from the Aeris filesystem.',parameters:object({path:Type.String()}),execute:async({path})=>{path=aerisPath(path);const content=await this.system.read(path,{priority:true});return{path,content:String(content).slice(0,12000),truncated:String(content).length>12000}},success:result=>`${result.content}${result.truncated?'\n\n[Output truncated]':''}` });
    this.#register({ name:'files_write',appId:'files',operation:'write_file',risk:'high',label:'Write file',description:'Create or replace a UTF-8 text file in the Aeris filesystem. Requires approval because an existing file may be overwritten.',parameters:object({path:Type.String(),content:Type.String()}),approval:params=>`Create or replace “${params.path}”?`,execute:async({path,content})=>{path=mutableAerisPath(path);await this.system.writeChunked(path,content,{priority:true});return{path,bytes:new TextEncoder().encode(content).length}},success:result=>`Saved ${result.path} (${result.bytes} bytes).` });
    this.#register({ name:'files_create_folder',appId:'files',operation:'create_folder',label:'Create folder',description:'Create a folder inside /home/aeris or /mnt/aeris.',parameters:object({path:Type.String()}),execute:async({path})=>{path=mutableAerisPath(path);await this.system.mkdir(path,{priority:true});return{path}},success:result=>`Created folder ${result.path}.` });
    this.#register({ name:'files_rename',appId:'files',operation:'rename',label:'Rename item',description:'Rename a file or folder without moving it to another directory.',parameters:object({path:Type.String(),name:Type.String()}),execute:async({path,name})=>{path=mutableAerisPath(path);const target=await this.system.rename(path,aerisName(name),{priority:true});return{path:target}},success:result=>`Renamed the item to ${result.path}.` });
    this.#register({ name:'files_copy',appId:'files',operation:'copy',label:'Duplicate item',description:'Duplicate a file or folder beside the original and choose a non-conflicting name.',parameters:object({path:Type.String()}),execute:async({path})=>({path:await this.system.copy(mutableAerisPath(path),{priority:true})}),success:result=>`Created ${result.path}.` });
    this.#register({ name:'files_move',appId:'files',operation:'move',label:'Move item',description:'Move a file or folder into another Aeris directory.',parameters:object({path:Type.String(),destination:Type.String()}),execute:async({path,destination})=>({path:await this.system.move(mutableAerisPath(path),aerisPath(destination),{priority:true})}),success:result=>`Moved the item to ${result.path}.` });
    this.#register({ name:'files_delete',appId:'files',operation:'delete',risk:'high',label:'Delete item',description:'Delete a file or folder by moving it to the Aeris Trash. Requires user approval.',parameters:object({path:Type.String()}),approval:params=>`Move “${params.path}” to Trash?`,execute:async({path})=>({path:await this.system.trash(mutableAerisPath(path),{priority:true})}),success:result=>`Moved the item to ${result.path}.` });
    this.#register({ name:'textedit_create_document',appId:'textedit',operation:'create_document',label:'Create text document',description:'Create or replace a text document in Desktop or Documents.',parameters:object({path:Type.String(),content:Type.String()}),execute:async({path,content})=>{if(!/^\/home\/aeris\/(Desktop|Documents)\//.test(path))throw new Error('Documents must be saved in Desktop or Documents.');await this.system.writeChunked(path,content);return{path}},success:result=>`Saved document ${result.path}.` });
    this.#register({ name:'preview_read_text',appId:'preview',operation:'read_text',label:'Read text file',description:'Read a text file from the Aeris Linux filesystem for inspection.',parameters:object({path:Type.String()}),execute:async({path})=>{if(!path.startsWith('/'))throw new Error('An absolute path is required.');const content=await this.system.read(path);return{path,content:String(content).slice(0,12000),truncated:String(content).length>12000}},success:result=>`${result.content}${result.truncated?'\n\n[Output truncated]':''}` });
    this.#register({ name:'photos_list',appId:'photos',operation:'list',label:'List photos',description:'List images in the Aeris Pictures folder.',parameters:object({}),execute:async()=>this.system.list('/home/aeris/Pictures',{fresh:true}),success:items=>items.length?JSON.stringify(items):'The photo library is empty.' });

    this.#register({ name:'weather_current',appId:'weather',operation:'current',label:'Read weather',description:'Read weather for any requested city or place. Always translate the requested location to its English place name before calling this tool. Omit location to use the location configured in Aeris Weather.',parameters:object({location:optionalString('English city or place name only, such as Shanghai, London, or San Francisco'),refresh:Type.Optional(Type.Boolean())}),execute:async({location,refresh},signal)=>{if(location)return this.weather.lookup(location,signal);if(refresh)await this.weather.refresh(true,{signal,timeout:15000});return this.weather.snapshot()},success:result=>JSON.stringify(result) });
    this.#register({ name:'clock_current_time',appId:'clock',operation:'current_time',label:'Read current time',description:'Read the current local date, time, and timezone.',parameters:object({}),execute:async()=>({iso:new Date().toISOString(),local:new Date().toString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}),success:result=>JSON.stringify(result) });
    this.#register({ name:'monitor_read_metrics',appId:'monitor',operation:'read_metrics',label:'Read system metrics',description:'Read the latest Linux memory, load, and uptime sample without blocking the conversation.',parameters:object({refresh:Type.Optional(Type.Boolean())}),execute:async({refresh})=>{const sample=this.metrics.snapshot();if(refresh||!sample.ready)this.metrics.refresh().catch(()=>{});return sample},success:result=>JSON.stringify(result) });
    this.#register({ name:'disk_list_volumes',appId:'diskutility',operation:'list_volumes',label:'List mounted volumes',description:'List mounted Aeris Linux filesystems.',parameters:object({}),execute:async()=>({output:(await this.system.exec('df -kP',12000)).output}),success:result=>result.output });

    this.#register({ name:'settings_update',appId:'settings',operation:'update',label:'Change system setting',description:'Apply an installed system theme by id, or change an allowed Aeris locale.',parameters:object({key:Type.Union([Type.Literal('theme'),Type.Literal('locale')]),value:Type.String()}),execute:async({key,value})=>{if(key==='theme'){if(!this.themeRuntime?.get(value))throw new Error(`Theme is not installed: ${value}`);this.themeRuntime.apply(value)}else{if(!['en','zh'].includes(value))throw new Error(`Unsupported locale value.`);this.settings.set(key,value)}return{key,value}},success:result=>`Changed ${result.key} to ${result.value}.` });
    this.#register({ name:'terminal_run_command',appId:'terminal',operation:'run_command',risk:'high',label:'Run terminal command',description:'Run a finite, non-interactive command inside the Aeris Linux guest from /home/aeris. Always requires explicit user approval.',parameters:object({command:Type.String({description:'A finite, non-interactive shell command. Add command flags that disable prompts and bound continuous output.'}),reason:optionalString('Why this command is required')}),approval:params=>`Allow Aeris AI to run this command?\n\n${params.command}${params.reason?`\n\nReason: ${params.reason}`:''}`,execute:async({command},signal)=>{const result=await this.system.runAgentCommand(command,60000,signal);if(result.code!==0)throw new Error(result.output||`Command exited with status ${result.code}.`);return{exitCode:result.code,output:result.output.slice(0,12000)}},success:result=>`Command exited with status ${result.exitCode}.\n${result.output}` });
    this.#register({ name:'machine_restart',appId:'machine',operation:'restart',risk:'high',label:'Restart virtual computer',description:'Restart the Aeris Linux virtual computer. Requires user approval.',parameters:object({reason:optionalString('Reason for restart')}),approval:params=>`Restart the Aeris Linux computer?${params.reason?`\n\n${params.reason}`:''}`,execute:async()=>{await this.machine.restart();return{restarted:true}},success:()=> 'The Aeris Linux computer is restarting.' });
    this.#register({ name:'trash_empty',appId:'trash',operation:'empty',risk:'high',label:'Empty Trash',description:'Permanently delete every item in Trash. Requires user approval.',parameters:object({}),approval:()=> 'Permanently delete every item in Trash? This cannot be undone.',execute:async()=>{await this.system.emptyTrash();return{emptied:true}},success:()=> 'Trash was emptied.' });

    this.#register({ name:'calculator_calculate',appId:'calculator',operation:'calculate',label:'Calculate expression',description:'Evaluate a basic arithmetic expression containing numbers and + - * / % parentheses.',parameters:object({expression:Type.String()}),execute:async({expression})=>{if(!/^[\d\s+\-*/%().]+$/.test(expression))throw new Error('Unsupported calculator expression.');const value=Function(`"use strict";return (${expression})`)();if(!Number.isFinite(value))throw new Error('The result is not finite.');return{expression,value}},success:result=>`${result.expression} = ${result.value}` });
    this.#register({ name:'music_list',appId:'music',operation:'list',label:'List local music',description:'List songs imported into the Aeris Music library.',parameters:object({query:optionalString('Optional song title, artist, or category')}),execute:async({query})=>{await this.music.refresh();const needle=String(query||'').toLowerCase();return this.music.snapshot().tracks.filter(track=>!needle||`${track.title} ${track.artist} ${track.category}`.toLowerCase().includes(needle)).slice(0,100)},success:tracks=>tracks.length?JSON.stringify(tracks):'No matching local songs.' });
    this.#register({ name:'music_play',appId:'music',operation:'play',label:'Play local music',description:'Play a local song by title or path in the real Aeris Music player.',parameters:object({song:Type.String({description:'Song title, partial title, or Aeris path'})}),execute:async({song})=>{if(!this.music.snapshot().tracks.length)await this.music.refresh();return this.music.play(song)},success:track=>`Now playing “${track.title}” by ${track.artist}.` });
    this.#register({ name:'music_pause',appId:'music',operation:'pause',label:'Pause music',description:'Pause the song currently playing in Aeris Music.',parameters:object({}),execute:async()=>{this.music.pause();return this.music.snapshot().current},success:track=>track?`Paused “${track.title}”.`:'Music is paused.' });

    this.#register({name:'browser_new_tab',appId:'browser',operation:'new_tab',label:'Open browser tab',description:'Open a URL or search query in a new Aeris Browser tab.',parameters:object({url:Type.String()}),execute:async({url})=>this.browser.newTab(url),success:tab=>`Opened ${tab.url} in a new Browser tab.`});
    this.#register({name:'browser_navigate',appId:'browser',operation:'navigate',label:'Navigate browser',description:'Navigate the Browser Use session and the active Aeris Browser view to an HTTP or HTTPS URL.',parameters:object({url:Type.String()}),execute:async({url},signal)=>{const remote=await this.browserAutomation.execute('navigate',{url},signal),tab=this.browser.navigate(url);return{tab,remote}},success:result=>`Navigated Browser to ${result.tab.url}.`});
    this.#register({name:'browser_current_page',appId:'browser',operation:'current_page',label:'Read current browser page',description:'Read the active Aeris Browser tab URL and metadata. This does not extract cross-origin page content.',parameters:object({}),execute:async()=>this.browser.active(),success:tab=>tab?JSON.stringify(tab):'No active Browser tab.'});
    this.#register({name:'browser_list_tabs',appId:'browser',operation:'list_tabs',label:'List browser tabs',description:'List the tabs currently open in Aeris Browser.',parameters:object({}),execute:async()=>this.browser.snapshot().tabs,success:tabs=>JSON.stringify(tabs)});
    this.#register({name:'browser_back',appId:'browser',operation:'back',label:'Browser back',description:'Navigate Browser Use and the Aeris Browser view backward in history.',parameters:object({}),execute:async(params,signal)=>{const remote=await this.browserAutomation.execute('back',{},signal),tab=this.browser.back();return{tab,remote}},success:result=>`Navigated back to ${result.tab.url}.`});
    this.#register({name:'browser_forward',appId:'browser',operation:'forward',label:'Browser forward',description:'Navigate the active Aeris Browser tab forward in its Aeris navigation history.',parameters:object({}),execute:async()=>this.browser.forward(),success:tab=>`Navigated forward to ${tab.url}.`});
    this.#register({name:'browser_automation_status',appId:'browser',operation:'automation_status',label:'Check browser automation',description:'Check whether the host-side Aeris backend and Browser Use MCP are available. This starts Browser Use only when explicitly requested.',parameters:object({connect:Type.Optional(Type.Boolean())}),execute:async({connect},signal)=>this.browserAutomation.capabilities({connect:!!connect,signal}),success:result=>JSON.stringify(result)});
    this.#register({name:'browser_inspect_page',appId:'browser',operation:'inspect_page',label:'Inspect browser page',description:'Read the current Browser Use page state and its indexed interactive elements.',parameters:object({includeScreenshot:Type.Optional(Type.Boolean())}),execute:async({includeScreenshot},signal)=>this.browserAutomation.execute('get_state',{include_screenshot:!!includeScreenshot},signal),success:result=>JSON.stringify(result.result)});
    this.#register({name:'browser_extract_content',appId:'browser',operation:'extract_content',label:'Read browser page content',description:'Extract structured content from the current page in the Browser Use session.',parameters:object({}),execute:async(params,signal)=>this.browserAutomation.execute('extract_content',{},signal),success:result=>JSON.stringify(result.result)});
    this.#register({name:'browser_click',appId:'browser',operation:'click',risk:'high',label:'Click browser element',description:'Click an indexed element in the Browser Use page. Requires approval because a click may submit data or change an external service.',parameters:object({index:Type.Number({minimum:0}),reason:optionalString('Why this element must be clicked')}),approval:params=>`Allow Aeris AI to click browser element ${params.index}?${params.reason?`\n\n${params.reason}`:''}`,execute:async({index},signal)=>this.browserAutomation.execute('click',{index},signal),success:(_,params)=>`Clicked browser element ${params.index}.`});
    this.#register({name:'browser_type',appId:'browser',operation:'type',risk:'high',label:'Type into browser',description:'Type text into an indexed Browser Use field. Requires approval because text is transmitted to the displayed website.',parameters:object({index:Type.Number({minimum:0}),text:Type.String(),reason:optionalString('Why this text must be entered')}),approval:params=>`Allow Aeris AI to type into browser element ${params.index}?\n\n${params.text}`,execute:async({index,text},signal)=>this.browserAutomation.execute('type',{index,text},signal),success:()=>`Entered text in the browser field.`});
    this.#register({name:'browser_scroll',appId:'browser',operation:'scroll',label:'Scroll browser page',description:'Scroll the current Browser Use page up or down.',parameters:object({direction:Type.Union([Type.Literal('up'),Type.Literal('down')]),amount:Type.Optional(Type.Number({minimum:1,maximum:10000}))}),execute:async({direction,amount},signal)=>this.browserAutomation.execute('scroll',{direction,...(amount?{amount}:{})},signal),success:(_,params)=>`Scrolled the browser ${params.direction}.`});

    for(const app of this.registry.list())this.#registerOpenApp(app);
  }
}
