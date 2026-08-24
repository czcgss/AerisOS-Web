import test from 'node:test';
import assert from 'node:assert/strict';
import {AppRegistry} from '../../src/apps/AppRegistry.js';
import {AppRuntimeService} from '../../src/apps/AppRuntimeService.js';
import {AppInstallationService} from '../../src/services/AppInstallationService.js';
import {counterPackage} from '../../src/apps/extensions/counter/package.js';

const memoryStorage=()=>{const values=new Map();return{values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}};
const app=id=>({id,title:id,icon:'grid',color:'blue',mount(){}});
const settings=storage=>({dockApps:['calendar','files'],get(key){return this[key]},set(key,value){this[key]=value;storage.setItem('aeris.settings',JSON.stringify({[key]:value}))}});
const userdata=()=>{const values=new Map([['calendar',{events:[{id:'event'}]}],['notifications',{items:[{id:'one',appId:'calendar'},{id:'two',appId:'reminders'}],delivered:{'calendar:event':1,'reminders:item':2}}]]);return{values,async remove(name){values.delete(name)},async load(name,fallback){return structuredClone(values.get(name)??fallback)},async save(name,value){values.set(name,structuredClone(value))}}};

test('built-in apps uninstall with private data and stay uninstalled',async()=>{
  const storage=memoryStorage(),registry=new AppRegistry(),prefs=settings(storage),data=userdata();registry.register(app('calendar'));registry.register(app('files'));
  storage.setItem('aeris.files.directory-cache','cached');
  const service=new AppInstallationService({registry,userdata:data,settings:prefs,storage});
  assert.equal(service.canUninstall('calendar'),true);
  assert.equal(await service.uninstall('calendar'),true);
  assert.equal(registry.get('calendar'),undefined);
  assert.deepEqual(prefs.dockApps,['files']);
  assert.equal(data.values.has('calendar'),false);
  assert.deepEqual(data.values.get('notifications').items.map(item=>item.appId),['reminders']);

  const nextRegistry=new AppRegistry();nextRegistry.register(app('calendar'));nextRegistry.register(app('files'));
  await new AppInstallationService({registry:nextRegistry,userdata:data,settings:prefs,storage}).prepare();
  assert.equal(nextRegistry.get('calendar'),undefined);
  assert.ok(nextRegistry.get('files'));
});

test('app-specific browser storage is removed without deleting shared system data',async()=>{
  const storage=memoryStorage(),registry=new AppRegistry(),prefs=settings(storage),data=userdata();registry.register(app('files'));
  storage.setItem('aeris.finder.view','gallery');storage.setItem('aeris.files.directory-cache','cached');storage.setItem('unrelated.user.document','keep');
  const service=new AppInstallationService({registry,userdata:data,settings:prefs,storage});await service.uninstall('files');
  assert.equal(storage.getItem('aeris.finder.view'),null);assert.equal(storage.getItem('aeris.files.directory-cache'),'cached');assert.equal(storage.getItem('unrelated.user.document'),'keep');
});

test('bundled runtime apps can be removed by the system app manager',async()=>{
  const storage=memoryStorage(),registry=new AppRegistry(),prefs=settings(storage),data=userdata(),runtime=new AppRuntimeService({registry,storage,bundledPackages:[counterPackage]});await runtime.prepare();
  const service=new AppInstallationService({registry,appRuntime:runtime,userdata:data,settings:prefs,storage});
  assert.equal(await service.uninstall('counter'),true);assert.equal(registry.get('counter'),undefined);assert.equal(runtime.get('counter'),null);
  const nextRegistry=new AppRegistry(),nextRuntime=new AppRuntimeService({registry:nextRegistry,storage,bundledPackages:[counterPackage]});await nextRuntime.prepare();
  await new AppInstallationService({registry:nextRegistry,appRuntime:nextRuntime,userdata:data,settings:prefs,storage}).prepare();assert.equal(nextRegistry.get('counter'),undefined);
});
