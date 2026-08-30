import test from 'node:test';
import assert from 'node:assert/strict';
import {SystemEntityService} from '../../src/entities/SystemEntityService.js';
import {createCalendarEntityProviders,createNotesEntityProvider,createRemindersEntityProvider} from '../../src/entities/providers/ProductivityEntityProviders.js';
import {createFileEntityProviders} from '../../src/entities/providers/FileEntityProvider.js';
import {createBrowserEntityProvider,createContactsEntityProvider,createMusicEntityProvider,createPhotosEntityProvider,createWeatherEntityProvider} from '../../src/entities/providers/BuiltinEntityProviders.js';
import {SystemToolService} from '../../src/services/SystemToolService.js';
import {AgentContextService} from '../../src/services/AgentContextService.js';

const clone=value=>structuredClone(value);
const fixture=()=>{
  const data=new Map([
    ['calendar',{calendars:[{id:'personal',name:'Personal',visible:true}],events:[{id:'event-1',title:'Product review',calendarId:'personal',start:'2026-08-31T10:00',end:'2026-08-31T11:00',location:'Studio',notes:'Review semantic layer',repeat:'none',alert:'15m'}]}],
    ['notes',[{id:'note-1',title:'Entity design',content:'Stable identifiers and App actions',pinned:true,updatedAt:100}]],
    ['reminders',[{id:'reminder-1',title:'Prepare review',due:'2026-08-31',dueTime:'09:00',done:false,priority:true,createdAt:50}]],
  ]),userdata={load:async(name,fallback)=>clone(data.has(name)?data.get(name):fallback)},directories={
    '/home/future':[{name:'Documents',type:'directory',size:0,modified:1},{name:'readme.txt',type:'file',size:42,modified:2}],
    '/home/future/Documents':[{name:'plan.md',type:'file',size:128,modified:3}],
    '/home/future/Desktop':[], '/home/future/Downloads':[], '/home/future/Pictures':[], '/mnt/future':[],
  },system={list:async path=>clone(directories[path]||[])};
  const entities=new SystemEntityService();
  [...createCalendarEntityProviders(userdata),createNotesEntityProvider(userdata),createRemindersEntityProvider(userdata),...createFileEntityProviders(system)].forEach(provider=>entities.register(provider));
  return{entities,userdata,system};
};

test('system entity search returns structured objects and exact App actions',async()=>{
  const{entities}=fixture(),result=await entities.search({query:'entity',types:['note'],appIds:['notes']});
  assert.equal(result.entities.length,1);const note=result.entities[0];
  assert.equal(note.uri,'future://notes/note-1');assert.equal(note.type,'note');assert.equal(note.properties.pinned,true);
  assert.deepEqual(note.actions[0],{id:'note.delete',label:'Delete note',tool:'future_notes',operation:'delete',risk:'high',mutates:true,parameters:{title:'Entity design',noteId:'note-1'}});
});

test('entity relationships resolve across permitted providers without leaking other Apps',async()=>{
  const{entities}=fixture(),related=await entities.related('future://reminders/reminder-1',{appIds:['reminders','calendar']});
  assert.equal(related.source.type,'reminder');assert.deepEqual(related.entities.map(item=>item.uri),['future://calendar/date/2026-08-31']);
  await assert.rejects(()=>entities.get('future://calendar/event/event-1',{appIds:['notes']}),/No permitted entity provider/);
});

test('filesystem entities resolve both files and folders sharing one URI namespace',async()=>{
  const{entities}=fixture(),folder=await entities.get('future://files/home/future/Documents',{appIds:['files']}),file=await entities.get('future://files/home/future/readme.txt',{appIds:['files']});
  assert.equal(folder.type,'filesystem.folder');assert.equal(file.type,'filesystem.file');assert.equal(file.properties.path,'/home/future/readme.txt');
  assert.equal(file.relationships[0].target,'future://files/home/future');assert.ok(file.actions.some(item=>item.operation==='read_file'));
});

test('built-in content Apps expose their focused objects as stable entities',async()=>{
  const userdata={load:async(name,fallback)=>name==='contacts'?[{id:'contact-1',name:'Ada Lovelace',email:'ada@example.com',favorite:true}]:name==='photos'?{favorites:['lake.png'],albums:[]}:fallback};
  const system={list:async path=>path==='/home/future/Pictures'?[{name:'lake.png',type:'file',size:512,modified:10}]:[]};
  const music={snapshot:()=>({tracks:[{id:'/mnt/future/Music/song.mp3',path:'/mnt/future/Music/song.mp3',name:'song.mp3',title:'Song',artist:'Artist',category:'Library',size:128}],current:null,playing:false})};
  const browser={snapshot:()=>({tabs:[{id:'tab-1',title:'Example',url:'https://example.com/',entries:['https://example.com/'],entryIndex:0,updatedAt:20}]})};
  const weather={snapshot:()=>({location:{name:'Shanghai',country:'China',latitude:31.23,longitude:121.47},data:{current:{temperature_2m:26},fetchedAt:30}})};
  const entities=new SystemEntityService();[createContactsEntityProvider(userdata),createMusicEntityProvider(music),createBrowserEntityProvider(browser),createPhotosEntityProvider(system,userdata),createWeatherEntityProvider(weather)].forEach(provider=>entities.register(provider));
  assert.equal((await entities.get('future://contacts/contact-1')).properties.email,'ada@example.com');
  assert.equal((await entities.get(`future://music/tracks/${encodeURIComponent('/mnt/future/Music/song.mp3')}`)).actions[0].operation,'play');
  assert.equal((await entities.get('future://browser/tabs/tab-1')).properties.url,'https://example.com/');
  assert.equal((await entities.get('future://photos/lake.png')).properties.favorite,true);
  assert.equal((await entities.search({types:['weather.location']})).entities[0].title,'Shanghai');
});

test('Agent entity tool inherits the worker App permission scope',async()=>{
  const{entities}=fixture(),apps=['calendar','notes','reminders','files'].map(id=>({id,title:id,icon:'document',color:'blue',mount(){}})),registry={get:id=>apps.find(app=>app.id===id),list:()=>apps,subscribe:()=>()=>{}},tools=new SystemToolService({entities,registry,i18n:{t:value=>value}});
  const noteTool=tools.entityAgentTool({allowedAppIds:['notes']});assert.ok(noteTool);assert.match(noteTool.description,/note/);assert.doesNotMatch(noteTool.description,/calendar\.event/);
  const result=await noteTool.execute('entity-call',{operation:'search',query:'Entity',types:['note'],limit:10});assert.equal(result.details.result.entities[0].uri,'future://notes/note-1');
  await assert.rejects(()=>noteTool.execute('entity-call-2',{operation:'get',uri:'future://calendar/event/event-1'}),/No permitted entity provider/);
  assert.equal(tools.entityAgentTool({allowedAppIds:[]}),null);
});

test('semantic workspace context preserves entity type and stable URI',()=>{
  const events=[],context=new AgentContextService();context.kernel={bus:{emit:(name,detail)=>events.push({name,detail})}};
  const snapshot=context.set({appId:'notes',resource:{kind:'note',entityType:'note',id:'note-1',uri:'future://notes/note-1',name:'Entity design'}});
  assert.equal(snapshot.resource.entityType,'note');assert.equal(snapshot.resource.uri,'future://notes/note-1');assert.match(context.promptBlock(),/"entityType": "note"/);
});

test('window context selection restores the last focused semantic resource',()=>{
  const listeners=new Map(),bus={on:(name,listener)=>{const set=listeners.get(name)||new Set();set.add(listener);listeners.set(name,set);return()=>set.delete(listener)},emit:(name,detail)=>{for(const listener of listeners.get(name)||[])listener(detail)}},apps=[{id:'notes',title:'notes'},{id:'calendar',title:'calendar'}],context=new AgentContextService({get:id=>apps.find(app=>app.id===id)},{t:value=>value});context.kernel={bus};context.start();
  const notesWindow={id:'window-notes',appId:'notes',title:'Notes',path:''},calendarWindow={id:'window-calendar',appId:'calendar',title:'Calendar',path:''};
  bus.emit('window:context-focused',notesWindow);context.set({appId:'notes',resource:{kind:'note',entityType:'note',id:'note-1',uri:'future://notes/note-1',name:'Entity design'}});
  bus.emit('window:context-focused',calendarWindow);assert.equal(context.snapshot().resource.kind,'application-window');
  context.focusWindow(notesWindow);assert.equal(context.snapshot().resource.uri,'future://notes/note-1');assert.equal(context.forWindow('window-notes').resource.name,'Entity design');
  bus.emit('window:closed',{id:'window-notes',appId:'notes',remaining:false});assert.equal(context.forWindow('window-notes'),null);context.stop();
});

test('entity service publishes semantic invalidation events for App data changes',()=>{
  const{entities}=fixture(),listeners=new Map(),published=[];entities.kernel={bus:{on:(name,listener)=>{listeners.set(name,listener);return()=>listeners.delete(name)},emit:(name,detail)=>published.push({name,detail})}};entities.start();
  listeners.get('userdata:change')({name:'notes',source:'notes-app'});listeners.get('filesystem:changed')({path:'/home/future/Desktop'});
  assert.deepEqual(published.filter(item=>item.name==='entities:changed').map(item=>({appId:item.detail.appId,reason:item.detail.reason})),[{appId:'notes',reason:'data'},{appId:'files',reason:'filesystem'}]);
  entities.stop();assert.equal(listeners.size,0);
});
