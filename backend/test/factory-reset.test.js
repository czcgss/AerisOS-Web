import assert from 'node:assert/strict';
import test from 'node:test';
import {FactoryResetService,clearNamespacedStorage} from '../../src/services/FactoryResetService.js';

const memoryStorage=entries=>{
  const values=new Map(Object.entries(entries));
  return{get length(){return values.size},key:index=>[...values.keys()][index]??null,removeItem:key=>values.delete(key),getItem:key=>values.get(key)??null,values};
};

test('factory reset removes only FutureOS browser data and reinstalls',async()=>{
  const events=[],calls=[],storage=memoryStorage({'future.settings':'{}','future-app':'1','host.preference':'keep'}),sessionStorage=memoryStorage({'future.setup.draft':'{}','host.session':'keep'});
  const service=new FactoryResetService({
    machine:{stop:async save=>calls.push(['stop',save]),deletePersistedState:async()=>calls.push(['machine-data'])},
    skillRegistry:{deleteData:async()=>calls.push(['skill-data'])},
    browserAutomation:{disconnect:async()=>calls.push(['browser'])},
    storage,sessionStorage,reload:()=>calls.push(['reload']),
  });
  service.kernel={bus:{emit:(name,detail)=>events.push([name,detail.status])}};

  assert.equal(await service.reset(),true);
  assert.deepEqual(calls,[['browser'],['stop',false],['machine-data'],['skill-data'],['reload']]);
  assert.equal(storage.getItem('future.settings'),null);
  assert.equal(storage.getItem('future-app'),null);
  assert.equal(storage.getItem('host.preference'),'keep');
  assert.equal(sessionStorage.getItem('future.setup.draft'),null);
  assert.equal(sessionStorage.getItem('host.session'),'keep');
  assert.deepEqual(events.map(([,status])=>status),['starting','clearing-machine','clearing-data','complete']);
});

test('storage cleanup handles adjacent keys without skipping',()=>{
  const storage=memoryStorage({'future.one':'1','future.two':'2','future-three':'3','unrelated':'4'});
  clearNamespacedStorage(storage);
  assert.deepEqual([...storage.values.entries()],[['unrelated','4']]);
});
