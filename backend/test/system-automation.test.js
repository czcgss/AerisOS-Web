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
import {locateSystemAgentCommand} from '../../src/shell/SystemAgentCommand.js';
import {TerminalAgentInput,isTerminalAgentTrigger,isTerminalCompositionKey,normalizeTerminalAgentInput,routeTerminalAgentData,shouldActivateTerminalAgentTrigger} from '../../src/apps/terminal/TerminalAgentInput.js';
import {AgentModeRegistryService} from '../../src/services/AgentModeRegistryService.js';

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
  const service=new AutomationService({storage,tasks});service.kernel={bus};service.setRunner({createSession:options=>{started.push(['create',options]);return 'automation-session'},send:async(id,prompt,options)=>started.push(['send',id,prompt,options])});service.start();
  const rule=service.create({name:'Daily plan',trigger:{type:'daily',time:'09:00'},action:{prompt:'Plan my day'}});
  await service.run(rule.id);
  assert.deepEqual(started,[['create',{title:'Daily plan',origin:'automation',automation:{id:rule.id,name:'Daily plan',triggerType:'daily',triggerReason:'manual'}}],['send','automation-session','Plan my day',{source:'automation'}]]);
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

test('contextual Agent entries preserve their independent window presentation',()=>{
  const bus=new EventBus(),events=[],service=new AgentEntryService({snapshot:()=>({appId:'notes'}),set(){}});service.kernel={bus};service.start();
  const writingTarget={operation:'replace',apply(){return true}};
  bus.on('ai:compact-entry',detail=>events.push(detail));service.open({source:'pointer-focus',mode:'compact',presentation:'contextual',anchor:{x:420,y:260},agentMode:'writing',writingTarget});
  assert.equal(events.length,1);assert.equal(events[0].presentation,'contextual');assert.deepEqual(events[0].anchor,{x:420,y:260});assert.deepEqual(events[0].context,{appId:'notes'});assert.equal(events[0].agentMode,'writing');assert.equal(events[0].writingTarget,writingTarget);
});

test('the system input protocol recognizes branded Agent commands',()=>{
  assert.deepEqual(locateSystemAgentCommand('@future rewrite this',20),{start:0,promptStart:8,end:20,prompt:'rewrite this'});
  assert.equal(locateSystemAgentCommand('ordinary text'),null);
  const value='Existing note\n@伏秋 总结以上内容',command=locateSystemAgentCommand(value,value.length);
  assert.equal(command.prompt,'总结以上内容');assert.equal(command.start,14);
  const inline='Keep this paragraph. @future continue writing',inlineCommand=locateSystemAgentCommand(inline,inline.length);
  assert.equal(inlineCommand.prompt,'continue writing');assert.equal(inline.slice(0,inlineCommand.start),'Keep this paragraph. ');
});

test('the terminal enters Agent mode after the branded command separator',()=>{
  assert.equal(isTerminalAgentTrigger('@future '),true);
  assert.equal(isTerminalAgentTrigger('@伏秋 '),true);
  assert.equal(isTerminalAgentTrigger('  @future '),true);
  assert.equal(isTerminalAgentTrigger('@future'),false);
  assert.equal(isTerminalAgentTrigger('echo @future'),false);
  assert.equal(isTerminalAgentTrigger('@future explain this'),false);
  const state={line:'',active:false,draft:''};
  assert.equal(routeTerminalAgentData(state,'@future ').output,'@future \u0015');
  assert.equal(state.active,true);
  assert.equal(routeTerminalAgentData(state,'list files').output,'');
  const submitted=routeTerminalAgentData(state,'\r');
  assert.equal(submitted.output,'');
  assert.equal(submitted.submitted,'list files');
  assert.equal(state.active,false);
  const pasted={line:'',active:false,draft:''},paste='\u001b[200~@future explain this\u001b[201~';
  const normalized=normalizeTerminalAgentInput(paste);
  assert.equal(normalized.input,'@future explain this');
  assert.equal(normalized.passthrough,false);
  const pasteStart=routeTerminalAgentData(pasted,normalized.input);
  assert.equal(pasteStart.output,'@future \u0015');
  assert.equal(pasted.active,true);
  assert.equal(pasted.draft,'explain this');
  assert.equal(normalizeTerminalAgentInput('\u001b[200~ls -la\u001b[201~').passthrough,true);
});

test('writing mode is registered without system capabilities and ignores IME process keys',()=>{
  const modes=new AgentModeRegistryService(),writing=modes.get('writing');
  assert.deepEqual(writing.capabilities,{tools:false,skills:false,collaboration:false,workflows:false});
  assert.equal(writing.selectable,false);assert.deepEqual(modes.list({selectableOnly:true}).map(mode=>mode.id),['general','chat']);
  assert.equal(isTerminalCompositionKey({isComposing:true,key:'n'}),true);
  assert.equal(isTerminalCompositionKey({keyCode:229,key:'n'}),true);
  assert.equal(isTerminalCompositionKey({key:'n'}),false);
  assert.equal(shouldActivateTerminalAgentTrigger('@future',{key:' '}),true);assert.equal(shouldActivateTerminalAgentTrigger('@future',{key:' ',isComposing:true}),false);
  const chinese={line:'',active:false,draft:''};routeTerminalAgentData(chinese,'@future ');routeTerminalAgentData(chinese,'查看进程');assert.equal(routeTerminalAgentData(chinese,'\r').submitted,'查看进程');
});
