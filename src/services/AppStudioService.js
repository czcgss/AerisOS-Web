import { Type } from '@earendil-works/pi-ai';
import { validateAppPackage } from '../platform/apps/AppPackage.js';

const textResult=(text,details={})=>({content:[{type:'text',text}],details});
const required=(input,key)=>{const value=String(input[key]||'').trim();if(!value)throw new Error(`App Studio requires ${key}.`);return value};
const parseObject=(value,label,fallback={})=>{if(value==null||value==='')return structuredClone(fallback);try{const parsed=typeof value==='string'?JSON.parse(value):value;if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed}catch{throw new Error(`${label} must be a JSON object.`)}};

export class AppStudioService {
  constructor(appRuntime){this.appRuntime=appRuntime;this.approvalService=null;this.drafts=new Map();}
  start() {}
  setApprovalService(service){this.approvalService=service;}

  tool(){
    const optional=description=>Type.Optional(Type.String({description}));
    return {
      name:'aeris_app_studio',
      label:'Aeris App Studio',
      description:'Inspect source, validate, install, update, list, and uninstall sandboxed Aeris app packages without using the terminal. Updating and uninstalling require explicit user approval. This tool is available only after loading the create-app skill.',
      parameters:Type.Object({
        type:Type.Union([Type.Literal('validate'),Type.Literal('install'),Type.Literal('update'),Type.Literal('list'),Type.Literal('inspect'),Type.Literal('uninstall')],{description:'App Studio operation.'}),
        draftId:optional('Validated draft id returned by validate.'),
        path:optional('For inspect, an exact package file path such as main/app.js. Omit to read the complete package.'),
        id:optional('Lowercase app id using letters, numbers, and hyphens.'),version:optional('Semantic version such as 1.0.0.'),
        nameEn:optional('English application name.'),nameZh:optional('Chinese application name.'),descriptionEn:optional('English description.'),descriptionZh:optional('Chinese description.'),
        icon:optional('Aeris icon id.'),color:optional('Aeris color: aqua, blue, green, grey, orange, pink, purple, red, or yellow.'),
        initialStateJson:optional('Initial shared state as a JSON object string.'),localeEnJson:optional('English translation dictionary as a JSON object string.'),localeZhJson:optional('Chinese translation dictionary as a JSON object string.'),
        mainHtml:optional('Main view HTML fragment.'),mainCss:optional('Main view CSS.'),mainJavaScript:optional('Main view JavaScript using the Aeris SDK.'),
        activityHtml:optional('Agent Activity view HTML fragment.'),activityCss:optional('Agent Activity view CSS.'),activityJavaScript:optional('Agent Activity JavaScript using the Aeris SDK.'),
      },{additionalProperties:false}),
      executionMode:'sequential',
      execute:async(toolCallId,input,signal,onUpdate)=>{
        if(input.type==='list'){
          const apps=this.appRuntime.list().map(item=>({id:item.manifest.id,name:item.manifest.name,version:item.manifest.version,source:item.source}));
          return textResult(apps.length?JSON.stringify(apps,null,2):'No extension apps are installed.',{skillId:'create-app',operation:'list',phase:'completed',result:{apps}});
        }
        if(input.type==='inspect'){
          const appId=required(input,'id'),record=this.appRuntime.list().find(item=>item.manifest.id===appId),appPackage=this.appRuntime.get(appId);
          if(!record||!appPackage)throw new Error(`Extension app is not installed: ${appId}`);
          const path=String(input.path||'').trim();
          if(path){if(typeof appPackage.files[path]!=='string')throw new Error(`App package file was not found: ${path}`);return textResult(appPackage.files[path],{skillId:'create-app',operation:'inspect',phase:'completed',result:{appId,path,bytes:new TextEncoder().encode(appPackage.files[path]).length,source:record.source}})}
          return textResult(JSON.stringify(appPackage,null,2),{skillId:'create-app',operation:'inspect',phase:'completed',result:{appId,manifest:appPackage.manifest,files:Object.fromEntries(Object.entries(appPackage.files).map(([name,content])=>[name,{bytes:new TextEncoder().encode(content).length}])),source:record.source}});
        }
        if(input.type==='install'){
          const draft=this.drafts.get(String(input.draftId||''));if(!draft)throw new Error('The validated App Studio draft was not found. Validate the app again.');
          const manifest=this.appRuntime.install(draft.package);this.drafts.delete(draft.id);
          return textResult(`Installed “${manifest.name.en}” (${manifest.id}) in Aeris. Its Main and Agent Activity views are now available.`,{skillId:'create-app',operation:'install',phase:'completed',result:{appId:manifest.id,manifest}});
        }
        if(input.type==='update'){
          const draft=this.drafts.get(String(input.draftId||''));if(!draft)throw new Error('The validated App Studio draft was not found. Inspect and validate the app again.');
          const appId=draft.package.manifest.id,record=this.appRuntime.list().find(item=>item.manifest.id===appId);
          if(!record)throw new Error(`Extension app is not installed: ${appId}`);
          if(record.source==='bundled')throw new Error(`Bundled app cannot be updated: ${appId}`);
          if(!this.approvalService)throw new Error('Aeris approval service is unavailable.');
          const title=record.manifest.name.en||appId,outcome=await this.approvalService.runProtected({toolCallId,name:'aeris_app_studio',label:`Update ${title}`,appId,operation:'update',params:{id:appId,version:draft.package.manifest.version},approvalMessage:`Update “${title}” (${appId}) to version ${draft.package.manifest.version}?\n\nThe validated application package will be replaced. Existing app data will be preserved.`},signal,onUpdate,()=>this.appRuntime.install(draft.package,{replace:true,preserveState:true}));
          if(!outcome.approved)return textResult('The user denied the app update request.',{...outcome.state,skillId:'create-app'});
          this.drafts.delete(draft.id);return textResult(`Updated “${title}” (${appId}) to ${draft.package.manifest.version}. Open Main and Agent Activity views were reloaded, and existing app data was preserved.`,{...outcome.state,skillId:'create-app',result:{appId,updated:true,reloaded:true,manifest:outcome.value}});
        }
        if(input.type==='uninstall'){
          const appId=required(input,'id'),record=this.appRuntime.list().find(item=>item.manifest.id===appId);
          if(!record)throw new Error(`Extension app is not installed: ${appId}`);
          if(record.source==='bundled')throw new Error(`Bundled app cannot be uninstalled: ${appId}`);
          if(!this.approvalService)throw new Error('Aeris approval service is unavailable.');
          const title=record.manifest.name.en||appId,outcome=await this.approvalService.runProtected({toolCallId,name:'aeris_app_studio',label:`Uninstall ${title}`,appId,operation:'uninstall',params:{id:appId},approvalMessage:`Uninstall “${title}” (${appId})?\n\nIts application package and saved state will be permanently removed.`},signal,onUpdate,()=>this.appRuntime.uninstall(appId));
          if(!outcome.approved)return textResult('The user denied the app uninstall request.',{...outcome.state,skillId:'create-app'});
          return textResult(`Uninstalled “${title}” (${appId}) from Aeris.`,{...outcome.state,skillId:'create-app',result:{appId,uninstalled:true}});
        }
        this.#assertDesignLanguage(input);
        const appPackage=validateAppPackage(this.#package(input)),draftId=crypto.randomUUID();
        this.drafts.set(draftId,{id:draftId,createdAt:Date.now(),package:appPackage});
        return textResult(`Validated ${appPackage.manifest.id} ${appPackage.manifest.version}. Both Main and Activity views, English and Chinese locales, package limits, permissions, and referenced files passed. Use type “install” with draftId “${draftId}” to install it.`,{skillId:'create-app',operation:'validate',phase:'completed',result:{draftId,manifest:appPackage.manifest}});
      },
    };
  }

  #assertDesignLanguage(input){
    for(const [field,scriptField,label] of [['mainCss','mainJavaScript','Main'],['activityCss','activityJavaScript','Activity']]){
      const css=String(input[field]||''),required=['--surface','--text','--accent'],missing=required.filter(token=>!new RegExp(`var\\(\\s*${token.replace('--','\\-\\-')}`).test(css));
      if(missing.length)throw new Error(`${label} CSS must use Aeris design tokens: ${missing.join(', ')}.`);
      if(/(?:animation|transition)\s*:/i.test(css)&&!/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i.test(css))throw new Error(`${label} CSS uses motion without a prefers-reduced-motion fallback.`);
      if(!/\bAeris\s*\.\s*environment\s*\.\s*subscribe\s*\(/.test(String(input[scriptField]||'')))throw new Error(`${label} must subscribe to Aeris.environment so theme and locale changes apply immediately.`);
    }
  }

  #package(input){
    const id=required(input,'id'),nameEn=required(input,'nameEn'),nameZh=required(input,'nameZh');
    return {manifest:{
      formatVersion:1,sdkVersion:'1',id,version:String(input.version||'1.0.0'),name:{en:nameEn,zh:nameZh},
      description:{en:required(input,'descriptionEn'),zh:required(input,'descriptionZh')},icon:String(input.icon||'package'),color:String(input.color||'aqua'),singleInstance:true,permissions:['storage'],
      initialState:parseObject(input.initialStateJson,'initialStateJson',{}),window:{width:760,height:560,minWidth:460,minHeight:360},
      views:{main:{html:'main/index.html',css:'main/style.css',script:'main/app.js'},activity:{html:'activity/index.html',css:'activity/style.css',script:'activity/app.js'}},
    },files:{
      'locales/en.json':JSON.stringify(parseObject(input.localeEnJson,'localeEnJson',{title:nameEn})),
      'locales/zh.json':JSON.stringify(parseObject(input.localeZhJson,'localeZhJson',{title:nameZh})),
      'main/index.html':required(input,'mainHtml'),'main/style.css':required(input,'mainCss'),'main/app.js':required(input,'mainJavaScript'),
      'activity/index.html':required(input,'activityHtml'),'activity/style.css':required(input,'activityCss'),'activity/app.js':required(input,'activityJavaScript'),
    }};
  }
}
