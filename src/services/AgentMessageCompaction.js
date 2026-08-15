const APP_STUDIO_TOOL='aeris_app_studio';
const APP_SOURCE_FIELDS=new Set([
  'initialStateJson','localeEnJson','localeZhJson',
  'mainHtml','mainCss','mainJavaScript',
  'activityHtml','activityCss','activityJavaScript',
]);
const clone=value=>structuredClone(value);
const characters=value=>String(value??'').length;
const messageText=message=>typeof message?.content==='string'?message.content:(message?.content||[]).filter(block=>block?.type==='text').map(block=>block.text||'').join('\n');

export const compactToolArguments=(name,args={})=>{
  if(name!==APP_STUDIO_TOOL||!args||typeof args!=='object'||Array.isArray(args))return clone(args||{});
  if(args.sourceSummary?.omitted)return clone(args);
  const compact={},fields={};let totalCharacters=0;
  for(const [key,value] of Object.entries(args)){
    if(APP_SOURCE_FIELDS.has(key)&&typeof value==='string'){
      const size=characters(value);fields[key]={characters:size};totalCharacters+=size;
    }else compact[key]=clone(value);
  }
  if(Object.keys(fields).length)compact.sourceSummary={omitted:true,totalCharacters,fields};
  return compact;
};

const compactAppStudioResult=message=>{
  const operation=message.details?.operation||'',text=messageText(message);
  if(operation!=='inspect'&&characters(text)<=4000)return clone(message);
  const {content:_,...metadata}=message,compact=clone(metadata),result=compact.details?.result||{},appId=result.appId||compact.details?.appId||result.manifest?.id||'extension app',path=result.path?` (${result.path})`:'',size=Number(result.bytes)||0;
  compact.content=[{type:'text',text:`App Studio ${operation||'operation'} completed for ${appId}${path}.${size?` ${size} source bytes were inspected.`:''} Full source was omitted from saved conversation history; inspect the app again before making another source change.`}];
  return compact;
};

export const compactAgentMessage=message=>{
  if(!message||typeof message!=='object')return message;
  if(message.role==='toolResult'&&message.toolName===APP_STUDIO_TOOL)return compactAppStudioResult(message);
  const {content,...metadata}=message,compact=clone(metadata);
  compact.content=Array.isArray(content)?content.map(block=>{
    if(block?.type!=='toolCall')return clone(block);
    const {arguments:args,...call}=block;
    return{...clone(call),arguments:compactToolArguments(block.name,args)};
  }):content;
  if(compact.details?.params)compact.details={...compact.details,params:compactToolArguments(compact.toolName,compact.details.params)};
  return compact;
};

export const compactAgentMessages=messages=>(messages||[]).map(compactAgentMessage);
