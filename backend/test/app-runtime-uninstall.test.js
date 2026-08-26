import test from 'node:test';
import assert from 'node:assert/strict';
import {AppRegistry} from '../../src/apps/AppRegistry.js';
import {AppRuntimeService} from '../../src/apps/AppRuntimeService.js';
import {counterPackage} from '../../src/apps/extensions/counter/package.js';

const memoryStorage=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}};

test('only user extension apps can be uninstalled with their saved state',async()=>{
  const storage=memoryStorage(),registry=new AppRegistry(),runtime=new AppRuntimeService({registry,storage,bundledPackages:[counterPackage]});
  await runtime.prepare();
  assert.equal(runtime.canUninstall('counter'),false);
  assert.equal(registry.get('counter').uninstallable,false);

  const userPackage=structuredClone(counterPackage);userPackage.manifest.id='user-counter';userPackage.manifest.name={en:'User Counter',zh:'用户计数器'};
  runtime.install(userPackage);
  assert.equal(runtime.canUninstall('user-counter'),true);
  assert.equal(registry.get('user-counter').uninstallable,true);
  storage.setItem('future.app-runtime.state.v1.user-counter',JSON.stringify({count:9}));

  assert.equal(runtime.uninstall('user-counter'),true);
  assert.equal(runtime.canUninstall('user-counter'),false);
  assert.equal(registry.get('user-counter'),undefined);
  assert.equal(storage.getItem('future.app-runtime.state.v1.user-counter'),null);
  assert.throws(()=>runtime.uninstall('counter'),/Bundled applications cannot be uninstalled/);
});
