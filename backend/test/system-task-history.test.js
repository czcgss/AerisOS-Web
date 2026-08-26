import assert from 'node:assert/strict';
import test from 'node:test';
import {automationNextRunAt,taskExecutionHistory} from '../../src/apps/ai/SystemTasks.js';

test('execution history excludes cancelled tasks and unrelated undo receipts',()=>{
  const tasks=[
    {id:'done',turnId:'turn-done',status:'completed',finishedAt:30,operations:[{id:'tool-done',appId:'calendar',operation:'create_event'}]},
    {id:'failed',turnId:'turn-failed',status:'failed',finishedAt:20,operations:[{id:'tool-failed',appId:'files',operation:'create_folder'}]},
    {id:'cancelled',turnId:'turn-cancelled',status:'cancelled',finishedAt:40,operations:[{id:'tool-cancelled',appId:'trash',operation:'empty'}]},
  ];
  const records=[
    {id:'receipt-done',taskId:'done',toolCallId:'tool-done',status:'completed',undoable:true},
    {id:'receipt-cancelled',taskId:'cancelled',toolCallId:'tool-cancelled',status:'completed',undoable:true},
    {id:'receipt-unrelated',taskId:'missing',toolCallId:'tool-missing',status:'completed',undoable:true},
    {id:'receipt-undone',taskId:'done',toolCallId:'tool-done',status:'undone',undoable:true},
  ];
  const history=taskExecutionHistory(tasks,records);
  assert.deepEqual(history.finished.map(task=>task.id),['done','failed']);
  assert.equal(history.undoable,1);
});

test('daily automation exposes its next scheduled execution',()=>{
  // Daily automations follow the computer's local wall clock. Construct both
  // values in the process timezone so this assertion is identical on a UTC CI
  // runner and a developer machine in another timezone.
  const now=new Date(2026,7,25,9,0,0,0).getTime();
  const next=automationNextRunAt({enabled:true,createdAt:now,lastRunAt:0,trigger:{type:'daily',time:'08:00'}},now);
  assert.equal(next,new Date(2026,7,26,8,0,0,0).getTime());
});
