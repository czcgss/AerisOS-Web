import test from 'node:test';
import assert from 'node:assert/strict';
import {agentTurnEnvironmentBlock,buildAgentSystemPrompt} from '../../src/services/AiAgentService.js';

test('agent system prompt remains byte-stable between turns',()=>{
  const input={configuredPrompt:'System instructions',timezone:'Asia/Shanghai',collaboration:'Agent directory',skills:'Skill catalog',loadedSkills:'Loaded skill'};
  assert.equal(buildAgentSystemPrompt(input),buildAgentSystemPrompt(input));
  assert.doesNotMatch(buildAgentSystemPrompt(input),/Current local date and time:/);
  assert.doesNotMatch(buildAgentSystemPrompt(input),/GMT|\d{4}-\d{2}-\d{2}T\d{2}:/);
});

test('volatile time data is isolated in the newest user turn',()=>{
  const first=agentTurnEnvironmentBlock(Date.UTC(2026,7,28,1,2,3),'Asia/Shanghai');
  const second=agentTurnEnvironmentBlock(Date.UTC(2026,7,28,1,3,3),'Asia/Shanghai');
  assert.notEqual(first,second);
  assert.match(first,/<turn_environment>/);
  assert.match(first,/2026-08-28T01:02:03\.000Z/);
  assert.match(first,/Asia\/Shanghai/);
});
