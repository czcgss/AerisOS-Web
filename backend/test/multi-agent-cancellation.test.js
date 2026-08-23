import test from 'node:test';
import assert from 'node:assert/strict';
import {MultiAgentOrchestratorService} from '../../src/services/MultiAgentOrchestratorService.js';

const profile={id:'computer',name:'Computer Agent',description:'Operates Aeris.',toolApps:['terminal'],skills:[],enabled:true};
const registry={list:()=>[profile],get:id=>id===profile.id?profile:null};
const toolService={
  apps:()=>[{id:'terminal',title:'Terminal'}],
  list:()=>[{appId:'terminal',operation:'run_command',label:'Run command',description:'Run a command.',risk:'high'}],
};

test('force stopping a session keeps its worktree cancelled after late worker results',async()=>{
  const service=new MultiAgentOrchestratorService({registry,toolService,storage:null});
  let resolveWorker,workerStarted;
  const started=new Promise(resolve=>{workerStarted=resolve});
  service.setRunner(async()=>{workerStarted();return new Promise(resolve=>{resolveWorker=resolve})});
  service.beginTurn('session-1','turn-1','Run a command');
  const execution=service.mainTool('session-1',()=> 'turn-1').execute('delegate-1',{tasks:[{agentId:'computer',task:'List files'}]},null);
  await started;

  const flow=service.workflows[0],worker=flow.nodes[1];
  worker.tools.push({id:'tool-1',name:'run_command',phase:'running',startedAt:Date.now(),finishedAt:0});
  service.abortSession('session-1');

  assert.equal(flow.status,'cancelled');
  assert.equal(flow.progress,100);
  assert.equal(flow.nodes[0].status,'cancelled');
  assert.equal(worker.status,'cancelled');
  assert.equal(worker.tools[0].phase,'cancelled');

  resolveWorker('late success');
  const result=await execution;
  assert.equal(result.details.phase,'cancelled');
  assert.equal(flow.status,'cancelled');
  assert.equal(flow.nodes[0].status,'cancelled');
  assert.equal(worker.status,'cancelled');
  service.finishTurn('turn-1','completed');
  assert.equal(flow.nodes[0].status,'cancelled');
});
