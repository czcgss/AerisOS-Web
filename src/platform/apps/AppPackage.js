export const APP_PACKAGE_FORMAT_VERSION = 1;
export const APP_SDK_VERSION = '1';

const APP_ID = /^[a-z][a-z0-9-]{1,47}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COLORS = new Set(['aqua', 'blue', 'green', 'grey', 'orange', 'pink', 'purple', 'red', 'yellow']);
const PERMISSIONS = new Set(['storage']);
const MAX_FILES = 48;
const MAX_PACKAGE_BYTES = 512 * 1024;

const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const copy = value => structuredClone(value);
const fail = message => { throw new Error(`Invalid Future app package: ${message}`); };

const safePath = value => {
  const path=String(value||'').replace(/^\.\//,'');
  if(!path||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'))fail(`unsafe file path “${value}”`);
  return path;
};

const localizedText = (value, field) => {
  if(!plainObject(value))fail(`${field} must be a localized object`);
  const result=Object.fromEntries(Object.entries(value).map(([locale,text])=>[String(locale),String(text||'').trim()]).filter(([,text])=>text));
  if(!result.en||!result.zh)fail(`${field} requires en and zh values`);
  return result;
};

const validateViewSource=(viewName,view,files)=>{
  const html=files[view.html],css=files[view.css],script=files[view.script];
  if(/<(?:script|iframe|frame|object|embed|link|base)\b/i.test(html))fail(`views.${viewName} HTML contains a restricted element`);
  if(/@import\b|url\(\s*['"]?https?:/i.test(css))fail(`views.${viewName} CSS may not load external resources`);
  const forbidden=/\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|EventSource|alert|confirm|prompt)\b|window\s*\.\s*(?:parent|top|opener|open)\b|document\s*\.\s*cookie\b/;
  const match=script.match(forbidden);if(match)fail(`views.${viewName} script uses restricted browser API “${match[0]}”`);
  if(!/\bFuture\s*\.\s*ready\b/.test(script))fail(`views.${viewName} script must wait for Future.ready`);
  if(!/\bFuture\s*\.\s*app\s*\.\s*subscribe\s*\(/.test(script))fail(`views.${viewName} script must subscribe to shared app state`);
  try{new Function(script)}catch(error){fail(`views.${viewName} script has invalid JavaScript: ${error.message}`)}
};

const view = (value, name, files) => {
  if(!plainObject(value))fail(`views.${name} is required`);
  const result={html:safePath(value.html),css:safePath(value.css),script:safePath(value.script)};
  for(const path of Object.values(result))if(typeof files[path]!=='string')fail(`views.${name} references missing file “${path}”`);
  return result;
};

export function validateAppPackage(source) {
  if(!plainObject(source)||!plainObject(source.manifest)||!plainObject(source.files))fail('manifest and files are required');
  const manifest=source.manifest;
  if(manifest.formatVersion!==APP_PACKAGE_FORMAT_VERSION)fail(`unsupported formatVersion “${manifest.formatVersion}”`);
  if(String(manifest.sdkVersion)!==APP_SDK_VERSION)fail(`unsupported sdkVersion “${manifest.sdkVersion}”`);
  if(!APP_ID.test(String(manifest.id||'')))fail('id must use lowercase letters, numbers, and hyphens');
  if(!VERSION.test(String(manifest.version||'')))fail('version must use semantic versioning');

  const files={};
  for(const [rawPath,content] of Object.entries(source.files)){
    const path=safePath(rawPath);
    if(typeof content!=='string')fail(`file “${path}” must contain text`);
    files[path]=content;
  }
  if(Object.keys(files).length>MAX_FILES)fail(`packages may contain at most ${MAX_FILES} files`);
  if(new TextEncoder().encode(JSON.stringify(files)).length>MAX_PACKAGE_BYTES)fail(`package exceeds ${MAX_PACKAGE_BYTES} bytes`);

  const localePaths={en:'locales/en.json',zh:'locales/zh.json'};
  for(const path of Object.values(localePaths)){
    if(typeof files[path]!=='string')fail(`missing locale file “${path}”`);
    try{const pack=JSON.parse(files[path]);if(!plainObject(pack))fail(`locale file “${path}” must contain an object`)}catch(error){if(error.message.startsWith('Invalid Future'))throw error;fail(`locale file “${path}” is not valid JSON`)}
  }

  const permissions=[...new Set((manifest.permissions||[]).map(String))];
  for(const permission of permissions)if(!PERMISSIONS.has(permission))fail(`unsupported permission “${permission}”`);
  const windowSource=plainObject(manifest.window)?manifest.window:{};
  const dimension=(key,fallback,min,max)=>Math.min(max,Math.max(min,Number(windowSource[key])||fallback));
  const normalizedManifest={
    formatVersion:APP_PACKAGE_FORMAT_VERSION,
    sdkVersion:APP_SDK_VERSION,
    id:String(manifest.id),
    version:String(manifest.version),
    name:localizedText(manifest.name,'name'),
    description:localizedText(manifest.description,'description'),
    icon:String(manifest.icon||'package'),
    color:COLORS.has(manifest.color)?manifest.color:'grey',
    singleInstance:manifest.singleInstance!==false,
    permissions,
    initialState:plainObject(manifest.initialState)?copy(manifest.initialState):{},
    window:{
      width:dimension('width',760,420,1400),height:dimension('height',540,320,1000),
      minWidth:dimension('minWidth',420,320,900),minHeight:dimension('minHeight',320,240,700),
    },
    views:{main:view(manifest.views?.main,'main',files),activity:view(manifest.views?.activity,'activity',files)},
  };
  validateViewSource('main',normalizedManifest.views.main,files);validateViewSource('activity',normalizedManifest.views.activity,files);
  return {manifest:normalizedManifest,files};
}

export function localePacks(appPackage) {
  return Object.fromEntries(['en','zh'].map(locale=>[locale,JSON.parse(appPackage.files[`locales/${locale}.json`])]));
}
