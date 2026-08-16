export const WIDGET_PACKAGE_FORMAT_VERSION=1;
export const WIDGET_SDK_VERSION='1';

const ID=/^[a-z][a-z0-9-]{1,47}$/;
const VERSION=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SIZES=new Set(['small','medium','large']);
const PERMISSIONS=new Set(['storage','app.open','calendar.read','reminders.read','weather.read','metrics.read','music.read','music.control']);
const MAX_FILES=32,MAX_PACKAGE_BYTES=384*1024;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(`Invalid Aeris widget package: ${message}`)};
const safePath=value=>{const path=String(value||'').replace(/^\.\//,'');if(!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'))fail(`unsafe file path “${value}”`);return path};
const localized=(value,field)=>{if(!plain(value))fail(`${field} must be a localized object`);const result=Object.fromEntries(Object.entries(value).map(([locale,text])=>[String(locale),String(text||'').trim()]).filter(([,text])=>text));if(!result.en||!result.zh)fail(`${field} requires en and zh values`);return result};

export function validateWidgetPackage(source){
  if(!plain(source)||!plain(source.manifest)||!plain(source.files))fail('manifest and files are required');
  const manifest=source.manifest;
  if(manifest.formatVersion!==WIDGET_PACKAGE_FORMAT_VERSION)fail(`unsupported formatVersion “${manifest.formatVersion}”`);
  if(String(manifest.sdkVersion)!==WIDGET_SDK_VERSION)fail(`unsupported sdkVersion “${manifest.sdkVersion}”`);
  if(!ID.test(String(manifest.id||'')))fail('id must use lowercase letters, numbers, and hyphens');
  if(!VERSION.test(String(manifest.version||'')))fail('version must use semantic versioning');
  const files={};
  for(const [rawPath,content] of Object.entries(source.files)){const path=safePath(rawPath);if(typeof content!=='string')fail(`file “${path}” must contain text`);files[path]=content}
  if(Object.keys(files).length>MAX_FILES)fail(`packages may contain at most ${MAX_FILES} files`);
  if(new TextEncoder().encode(JSON.stringify(files)).length>MAX_PACKAGE_BYTES)fail(`package exceeds ${MAX_PACKAGE_BYTES} bytes`);
  for(const path of ['locales/en.json','locales/zh.json']){if(typeof files[path]!=='string')fail(`missing locale file “${path}”`);try{if(!plain(JSON.parse(files[path])))fail(`locale file “${path}” must contain an object`)}catch(error){if(error.message.startsWith('Invalid Aeris'))throw error;fail(`locale file “${path}” is not valid JSON`)}}
  const entry=plain(manifest.entry)?{html:safePath(manifest.entry.html),css:safePath(manifest.entry.css),script:safePath(manifest.entry.script)}:null;if(!entry)fail('entry is required');
  for(const path of Object.values(entry))if(typeof files[path]!=='string')fail(`entry references missing file “${path}”`);
  if(/<(?:script|iframe|frame|object|embed|link|base)\b/i.test(files[entry.html]))fail('entry HTML contains a restricted element');
  if(/@import\b|url\(\s*['"]?https?:/i.test(files[entry.css]))fail('entry CSS may not load external resources');
  const forbidden=/\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|EventSource|alert|confirm|prompt)\b|window\s*\.\s*(?:parent|top|opener|open)\b|document\s*\.\s*cookie\b/;
  const match=files[entry.script].match(forbidden);if(match)fail(`entry script uses restricted browser API “${match[0]}”`);
  if(!/\bAerisWidget\s*\.\s*ready\b/.test(files[entry.script]))fail('entry script must wait for AerisWidget.ready');
  try{new Function(files[entry.script])}catch(error){fail(`entry script has invalid JavaScript: ${error.message}`)}
  const sizes=[...new Set((manifest.sizes||[]).map(String))];if(!sizes.length)fail('sizes must contain at least one supported size');for(const size of sizes)if(!SIZES.has(size))fail(`unsupported size “${size}”`);
  const defaultSize=String(manifest.defaultSize||sizes[0]);if(!sizes.includes(defaultSize))fail('defaultSize must be included in sizes');
  const permissions=[...new Set((manifest.permissions||[]).map(String))];for(const permission of permissions)if(!PERMISSIONS.has(permission))fail(`unsupported permission “${permission}”`);
  const script=files[entry.script],requires=permission=>{if(!permissions.includes(permission))fail(`entry script uses a capability that requires permission “${permission}”`)};
  for(const [source,permission] of Object.entries({calendar:'calendar.read',reminders:'reminders.read',weather:'weather.read',metrics:'metrics.read',music:'music.read'})){
    if(new RegExp(`\\bAerisWidget\\s*\\.\\s*data\\s*\\.\\s*(?:get|subscribe)\\s*\\(\\s*['"]${source}['"]`).test(script))requires(permission);
  }
  if(/\bAerisWidget\s*\.\s*music\s*\./.test(script))requires('music.control');
  if(/\bAerisWidget\s*\.\s*state\s*\./.test(script))requires('storage');
  if(/\bAerisWidget\s*\.\s*apps\s*\.\s*open\s*\(/.test(script))requires('app.open');
  const refresh=plain(manifest.refresh)?manifest.refresh:{};const mode=refresh.mode==='interval'?'interval':'event';
  return{manifest:{formatVersion:WIDGET_PACKAGE_FORMAT_VERSION,sdkVersion:WIDGET_SDK_VERSION,id:String(manifest.id),version:String(manifest.version),name:localized(manifest.name,'name'),description:localized(manifest.description,'description'),icon:String(manifest.icon||'grid'),sizes,defaultSize,permissions,initialState:plain(manifest.initialState)?structuredClone(manifest.initialState):{},refresh:{mode,interval:mode==='interval'?Math.max(60,Math.min(3600,Number(refresh.interval)||300)):0},entry},files};
}

export function widgetLocalePacks(widgetPackage){return Object.fromEntries(['en','zh'].map(locale=>[locale,JSON.parse(widgetPackage.files[`locales/${locale}.json`])]))}
