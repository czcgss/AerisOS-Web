import assert from 'node:assert/strict';
import test from 'node:test';
import {EventBus} from '../../src/kernel/EventBus.js';
import {SystemTaskService} from '../../src/services/SystemTaskService.js';

const storageWith=(saved=[])=>{
  const values=new Map(saved.length?[['future.system-tasks.v1',JSON.stringify(saved)]]:[]);
  return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};
const startedService=(saved=[])=>{const service=new SystemTaskService(storageWith(saved));service.kernel={bus:new EventBus()};service.start();return service};

test('ordinary Agent conversation never becomes a system task',()=>{
  const service=startedService(),bus=service.kernel.bus;
  bus.emit('ai:agent-event',{sessionId:'chat-1',turnId:'turn-hi',prompt:'hi',event:{type:'turn_created'}});
  bus.emit('ai:task-status',{sessionId:'chat-1',turnId:'turn-hi',status:'completed'});
  assert.deepEqual(service.snapshot(),{tasks:[],running:0,waiting:0});
  service.stop();
});

test('system tool execution creates a task from the operation and parameters',()=>{
  const service=startedService(),bus=service.kernel.bus;
  bus.emit('ai:agent-event',{sessionId:'chat-2',turnId:'turn-calendar',prompt:'Please put this on my calendar',event:{type:'turn_created'}});
  bus.emit('capability:execution',{sessionId:'chat-2',turnId:'turn-calendar',toolCallId:'tool-1',label:'Create calendar event',name:'future_calendar',appId:'calendar',operation:'create_event',params:{title:'Buy books',date:'2026-08-25',hour:20},phase:'running'});
  const [task]=service.snapshot().tasks;
  assert.equal(task.title,'Create calendar event');
  assert.match(task.taskContent,/Title: Buy books/);
  assert.match(task.taskContent,/Date: 2026-08-25/);
  assert.doesNotMatch(task.taskContent,/Please put this/);
  assert.equal(task.prompt,'Please put this on my calendar');
  assert.deepEqual(task.operations.map(step=>({label:step.label,operation:step.operation,phase:step.phase})),[{label:'Create calendar event',operation:'create_event',phase:'running'}]);
  bus.emit('capability:execution',{sessionId:'chat-2',turnId:'turn-calendar',toolCallId:'tool-1',label:'Create calendar event',name:'future_calendar',appId:'calendar',operation:'create_event',params:{title:'Buy books',date:'2026-08-25',hour:20},phase:'completed',finishedAt:Date.now()});
  bus.emit('ai:task-status',{sessionId:'chat-2',turnId:'turn-calendar',status:'completed'});
  assert.equal(service.snapshot().tasks[0].status,'completed');
  assert.equal(service.snapshot().tasks[0].operations[0].phase,'completed');
  assert.equal(service.remove(task.id),true);
  assert.equal(service.snapshot().tasks[0].dismissed,true);
  service.stop();
});

test('delegated work uses isolated Agent assignments as task content',()=>{
  const service=startedService(),bus=service.kernel.bus;
  bus.emit('ai:agent-event',{sessionId:'chat-3',turnId:'turn-research',prompt:'Handle this for me',event:{type:'turn_created'}});
  bus.emit('multi-agent:workflow',{sessionId:'chat-3',turnId:'turn-research',workflow:{id:'flow-1',progress:25,nodes:[{id:'main',parentId:'',task:'Handle this for me'},{id:'worker',parentId:'main',agentName:'Research Agent',task:'Collect three primary sources and summarize the findings.'}]}});
  const [task]=service.snapshot().tasks;
  assert.equal(task.title,'Research Agent');
  assert.equal(task.taskContent,'Collect three primary sources and summarize the findings.');
  assert.doesNotMatch(task.taskContent,/Handle this for me/);
  service.stop();
});

test('task-control tools remove their delegated query from the task list',()=>{
  const service=startedService(),bus=service.kernel.bus;
  bus.emit('ai:agent-event',{sessionId:'chat-4',turnId:'turn-list',prompt:'List my tasks',event:{type:'turn_created'}});
  bus.emit('multi-agent:workflow',{sessionId:'chat-4',turnId:'turn-list',workflow:{id:'flow-list',progress:20,nodes:[{id:'main',parentId:'',task:'List my tasks'},{id:'computer',parentId:'main',agentName:'Computer',task:'Read the current system task list.'}]}});
  assert.equal(service.snapshot().tasks.length,1);
  bus.emit('capability:execution',{sessionId:'chat-4',turnId:'turn-list',toolCallId:'tool-list',label:'List system tasks',name:'future_tasks',appId:'tasks',operation:'list_tasks',taskTracking:'ignore',params:{},phase:'running'});
  assert.deepEqual(service.snapshot(),{tasks:[],running:0,waiting:0});
  bus.emit('multi-agent:workflow',{sessionId:'chat-4',turnId:'turn-list',workflow:{id:'flow-list',progress:80,nodes:[{id:'main',parentId:'',task:'List my tasks'},{id:'computer',parentId:'main',agentName:'Computer',task:'Read the current system task list.'}]}});
  assert.deepEqual(service.snapshot(),{tasks:[],running:0,waiting:0});
  service.stop();
});

test('a real system action later in the same turn can still become a task',()=>{
  const service=startedService(),bus=service.kernel.bus;
  bus.emit('ai:agent-event',{sessionId:'chat-5',turnId:'turn-mixed',prompt:'Check tasks, then create an event',event:{type:'turn_created'}});
  bus.emit('capability:execution',{sessionId:'chat-5',turnId:'turn-mixed',toolCallId:'tool-list',label:'List system tasks',appId:'tasks',operation:'list_tasks',taskTracking:'ignore',params:{},phase:'completed'});
  bus.emit('capability:execution',{sessionId:'chat-5',turnId:'turn-mixed',toolCallId:'tool-create',label:'Create calendar event',appId:'calendar',operation:'create_event',taskTracking:'track',params:{title:'Buy books'},phase:'running'});
  assert.deepEqual(service.snapshot().tasks.map(task=>({title:task.title,operations:task.operations.map(step=>step.operation)})),[{title:'Create calendar event',operations:['create_event']}]);
  service.stop();
});

test('an automation turn attaches to its existing scheduled execution',()=>{
  const service=startedService(),bus=service.kernel.bus;
  const task=service.begin({origin:'automation',kind:'automation',sessionId:'automation-chat',automationId:'daily-note',title:'Daily note'});
  bus.emit('ai:agent-event',{sessionId:'automation-chat',turnId:'automation-turn',prompt:'Create today’s note',event:{type:'turn_created'}});
  bus.emit('capability:execution',{sessionId:'automation-chat',turnId:'automation-turn',toolCallId:'tool-note',label:'Create note',appId:'notes',operation:'create',params:{title:'Today'},phase:'running'});
  const tasks=service.snapshot().tasks;
  assert.equal(tasks.length,1);
  assert.equal(tasks[0].id,task.id);
  assert.equal(tasks[0].turnId,'automation-turn');
  assert.deepEqual(tasks[0].operations.map(step=>step.operation),['create']);
  service.stop();
});

test('legacy conversation-only records are removed while real tool tasks remain',()=>{
  const service=startedService([
    {id:'old-chat',origin:'conversation',title:'hi',prompt:'hi',status:'completed'},
    {id:'old-tool',origin:'conversation',title:'please do it',prompt:'please do it',status:'completed',activeTool:{label:'Create folder'}},
    {id:'old-query',origin:'conversation',title:'Computer',taskContent:'Read the current system task list.',status:'completed',activeTool:{label:'List system tasks',appId:'tasks',operation:'list_tasks'}},
  ]);
  assert.deepEqual(service.snapshot().tasks.map(task=>({id:task.id,title:task.title,taskContent:task.taskContent})),[{id:'old-tool',title:'Create folder',taskContent:'Create folder'}]);
  service.stop();
});
