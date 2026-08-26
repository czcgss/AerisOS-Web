import test from 'node:test';
import assert from 'node:assert/strict';
import {EventBus} from '../../src/kernel/EventBus.js';
import {SystemTaskService} from '../../src/services/SystemTaskService.js';
import {OperationHistoryService} from '../../src/services/OperationHistoryService.js';
import {AutomationService} from '../../src/services/AutomationService.js';
import {AgentRegistryService} from '../../src/services/AgentRegistryService.js';
import {AppRegistry} from '../../src/apps/AppRegistry.js';
import {AgentEntryService} from '../../src/services/AgentEntryService.js';
import {AppInstallationService} from '../../src/services/AppInstallationService.js';

const memoryStorage=()=>{const values=new Map();return{values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}};

test('system tasks follow an Agent turn through tool work and completion',()=>{
  const storage=memoryStorage(),bus=new EventBus(),service=new SystemTaskService(storage);service.kernel={bus};service.start();
  bus.emit('ai:agent-event',{sessionId:'session-1',turnId:'turn-1',prompt:'Prepare a morning brief',event:{type:'turn_created'}});
  assert.equal(service.snapshot().tasks.length,0);
  bus.emit('capability:execution',{sessionId:'session-1',turnId:'turn-1',toolCallId:'tool-1',phase:'approval',label:'Read calendar',appId:'calendar'});
  let task=service.snapshot().tasks[0];assert.equal(task.title,'Read calendar');assert.equal(task.status,'approval');assert.equal(task.activeTool.appId,'calendar');
  assert.equal(service.remove(task.id),false);
  bus.emit('ai:task-status',{sessionId:'session-1',turnId:'turn-1',status:'completed'});
  task=service.snapshot().tasks[0];assert.equal(task.status,'completed');assert.equal(task.progress,100);service.stop();
});

test('unfinished persisted tasks become cancelled after a browser restore',()=>{
  const storage=memoryStorage();storage.setItem('future.system-tasks.v1',JSON.stringify([{id:'old',status:'running',createdAt:1,updatedAt:1}]));
  const service=new SystemTaskService(storage);service.kernel={bus:new EventBus()};service.start();
  assert.equal(service.snapshot().tasks[0].status,'cancelled');
  assert.equal(JSON.parse(storage.getItem('future.system-tasks.v1'))[0].status,'cancelled');service.stop();
});

test('operation receipts invoke their registered inverse exactly once',async()=>{
  const storage=memoryStorage(),service=new OperationHistoryService(storage),calls=[];service.kernel={bus:new EventBus()};service.start();
  service.register('notes_create',async result=>{calls.push(result.id);return{removed:result.id}});
  const receipt=service.record({definitionName:'notes_create',label:'Create note',result:{id:'note-1'},undoable:true});
  const undone=await service.undo(receipt.id);assert.equal(undone.status,'undone');assert.deepEqual(calls,['note-1']);
  await assert.rejects(()=>service.undo(receipt.id),/can no longer be undone/);assert.deepEqual(calls,['note-1']);
});

test('manual automations run in a background Agent session and update state',async()=>{
  const storage=memoryStorage(),bus=new EventBus(),started=[];
  const tasks={begin:value=>({id:'task-1',...value}),snapshot:()=>({tasks:[]}),update(){}};
  const service=new AutomationService({storage,tasks});service.kernel={bus};service.setRunner({createSession:()=> 'automation-session',renameSession:(id,name)=>started.push(['rename',id,name]),send:async(id,prompt)=>started.push(['send',id,prompt])});service.start();
  const rule=service.create({name:'Daily plan',trigger:{type:'daily',time:'09:00'},action:{prompt:'Plan my day'}});
  await service.run(rule.id);
  assert.deepEqual(started,[['rename','automation-session','Daily plan'],['send','automation-session','Plan my day']]);
  assert.equal(service.get(rule.id).lastStatus,'completed');assert.ok(service.get(rule.id).lastRunAt);service.stop();
});

test('the built-in Computer Agent owns system task and automation tools',()=>{
  const service=new AgentRegistryService({storage:memoryStorage()});service.start();
  assert.ok(service.get('computer').toolApps.includes('tasks'));
});

test('existing Computer Agent profiles receive the new task capability once',()=>{
  const storage=memoryStorage();storage.setItem('future.ai.agents.v1',JSON.stringify([{id:'computer',name:'My Computer',toolApps:['terminal'],enabled:true}]));
  const service=new AgentRegistryService({storage});service.start();assert.deepEqual(service.get('computer').toolApps,['terminal','tasks']);
  service.update('computer',{toolApps:['terminal']});const restored=new AgentRegistryService({storage});restored.start();assert.deepEqual(restored.get('computer').toolApps,['terminal']);
});

test('internal Agent capabilities are addressable but never listed as desktop apps',()=>{
  const registry=new AppRegistry(),capability={id:'tasks',title:'Task Center',internal:true,mount(){}};registry.register(capability);
  assert.equal(registry.get('tasks'),capability);assert.deepEqual(registry.list(),[]);assert.deepEqual(registry.list({includeInternal:true}),[capability]);
  const installation=new AppInstallationService({registry,storage:memoryStorage()});assert.equal(installation.canUninstall('tasks'),false);
});

test('the system task tray opens the Agent task workspace without a desktop app',async()=>{
  const bus=new EventBus(),events=[],service=new AgentEntryService({snapshot:()=>null,set(){}});service.kernel={bus};service.start();
  bus.on('shell:open-app',detail=>events.push(['open',detail]));bus.on('ai:entry',detail=>events.push(['entry',detail]));
  service.open({source:'system-task-tray',workspace:'tasks'});await Promise.resolve();
  assert.equal(events[0][1].id,'ai');assert.equal(events[1][1].workspace,'tasks');assert.equal(events[1][1].settings,false);
});
