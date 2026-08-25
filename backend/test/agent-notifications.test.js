import test from 'node:test';
import assert from 'node:assert/strict';
import {EventBus} from '../../src/kernel/EventBus.js';
import {AgentNotificationService} from '../../src/services/AgentNotificationService.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));

class MemoryNotifications{
  constructor(){this.items=[]}
  bySource(sourceKey){return structuredClone(this.items.find(item=>item.sourceKey===sourceKey)||null)}
  async publish(value){const existing=this.items.find(item=>item.sourceKey===value.sourceKey);if(existing)Object.assign(existing,structuredClone(value));else this.items.unshift({id:crypto.randomUUID(),read:false,...structuredClone(value)});return this.bySource(value.sourceKey)}
}

test('Agent notifications retain the owning session and follow approval state',async()=>{
  const notifications=new MemoryNotifications(),bus=new EventBus(),aiAgent={snapshot:()=>({sessions:[{id:'session-b',title:'Background research'}]})},service=new AgentNotificationService({notifications,aiAgent,tools:{},queryUser:{},i18n:{t:key=>key}});service.kernel={bus};service.start();

  bus.emit('capability:execution',{toolCallId:'tool-1',sessionId:'session-b',turnId:'turn-2',phase:'approval',label:'Delete file',approvalMessage:'Delete /home/future/demo.txt?'});
  await flush();
  const pending=notifications.bySource('agent:approval:tool-1');
  assert.equal(pending.category,'approval');
  assert.equal(pending.agent.sessionId,'session-b');
  assert.equal(pending.agent.turnId,'turn-2');
  assert.equal(pending.agent.sessionTitle,'Background research');

  bus.emit('capability:execution',{toolCallId:'tool-1',sessionId:'session-b',turnId:'turn-2',phase:'completed'});
  await flush();
  const completed=notifications.bySource('agent:approval:tool-1');
  assert.equal(completed.agent.status,'completed');
  assert.equal(completed.read,true);
  service.stop();
});

test('completed background turns publish a session-addressable notification',async()=>{
  const notifications=new MemoryNotifications(),bus=new EventBus(),aiAgent={snapshot:()=>({sessions:[{id:'session-a',title:'Current'},{id:'session-b',title:'Background task'}]})},service=new AgentNotificationService({notifications,aiAgent,tools:{},queryUser:{},i18n:{t:key=>key}});service.kernel={bus};service.start();
  bus.emit('ai:task-status',{sessionId:'session-b',turnId:'turn-b',status:'completed'});
  await flush();
  const item=notifications.bySource('agent:task:session-b:turn-b');
  assert.equal(item.type,'agent');
  assert.equal(item.agent.sessionId,'session-b');
  assert.equal(item.agent.turnId,'turn-b');
  assert.equal(item.agent.sessionTitle,'Background task');
  service.stop();
});

test('foreground conversation completion does not create a redundant notification',async()=>{
  const notifications=new MemoryNotifications(),bus=new EventBus(),aiAgent={snapshot:()=>({sessions:[{id:'session-a',title:'Visible conversation'}]})},service=new AgentNotificationService({notifications,aiAgent,tools:{},queryUser:{},i18n:{t:key=>key}});service.kernel={bus};service.start();
  bus.emit('ai:surface-session',{surface:'full',sessionId:'session-a'});
  bus.emit('window:focused','ai');
  bus.emit('ai:task-status',{sessionId:'session-a',turnId:'turn-a',status:'completed'});
  await flush();
  assert.equal(notifications.items.length,0);
  service.stop();
});
