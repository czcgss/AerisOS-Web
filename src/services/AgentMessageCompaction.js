const APP_STUDIO_TOOL='future_app_studio',WIDGET_STUDIO_TOOL='future_widget_studio',THEME_STUDIO_TOOL='future_theme_studio',STUDIO_TOOLS=new Set([APP_STUDIO_TOOL,WIDGET_STUDIO_TOOL,THEME_STUDIO_TOOL]);
const APP_SOURCE_FIELDS=new Set([
  'initialStateJson','localeEnJson','localeZhJson',
  'mainHtml','mainCss','mainJavaScript',
  'activityHtml','activityCss','activityJavaScript',
]);
const WIDGET_SOURCE_FIELDS=new Set(['initialStateJson','localeEnJson','localeZhJson','widgetHtml','widgetCss','widgetJavaScript']);
const THEME_SOURCE_FIELDS=new Set(['packageJson']);
const clone=value=>structuredClone(value);
const characters=value=>String(value??'').length;
const messageText=message=>typeof message?.content==='string'?message.content:(message?.content||[]).filter(block=>block?.type==='text').map(block=>block.text||'').join('\n');

export const compactToolArguments=(name,args={})=>{
  if(!STUDIO_TOOLS.has(name)||!args||typeof args!=='object'||Array.isArray(args))return clone(args||{});
  if(args.sourceSummary?.omitted)return clone(args);
  const sourceFields=name===APP_STUDIO_TOOL?APP_SOURCE_FIELDS:name===WIDGET_STUDIO_TOOL?WIDGET_SOURCE_FIELDS:THEME_SOURCE_FIELDS;
  const compact={},fields={};let totalCharacters=0;
  for(const [key,value] of Object.entries(args)){
    if(sourceFields.has(key)&&typeof value==='string'){
      const size=characters(value);fields[key]={characters:size};totalCharacters+=size;
    }else compact[key]=clone(value);
  }
  if(Object.keys(fields).length)compact.sourceSummary={omitted:true,totalCharacters,fields};
  return compact;
};

const compactStudioResult=message=>{
  const operation=message.details?.operation||'',text=messageText(message);
  if(operation!=='inspect'&&characters(text)<=4000)return clone(message);
  const {content:_,...metadata}=message,compact=clone(metadata),result=compact.details?.result||{},resourceId=result.appId||result.widgetId||compact.details?.appId||result.manifest?.id||'extension',path=result.path?` (${result.path})`:'',size=Number(result.bytes)||0,studio=message.toolName===WIDGET_STUDIO_TOOL?'Widget Studio':message.toolName===THEME_STUDIO_TOOL?'Theme Studio':'App Studio',resource=message.toolName===WIDGET_STUDIO_TOOL?'widget':message.toolName===THEME_STUDIO_TOOL?'theme':'app';
  compact.content=[{type:'text',text:`${studio} ${operation||'operation'} completed for ${resourceId}${path}.${size?` ${size} source bytes were inspected.`:''} Full source was omitted from saved conversation history; inspect the ${resource} again before making another source change.`}];
  return compact;
};

export const compactAgentMessage=message=>{
  if(!message||typeof message!=='object')return message;
  if(message.role==='toolResult'&&STUDIO_TOOLS.has(message.toolName))return compactStudioResult(message);
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

export const shouldCompactLiveProtocol=message=>message?.role==='toolResult'&&STUDIO_TOOLS.has(message?.toolName)&&!message?.isError&&message?.details?.phase==='completed';

export const compactAgentEvent=event=>{
  if(!event||typeof event!=='object')return event;
  const compact={...event};
  if(event.message)compact.message=compactAgentMessage(event.message);
  if(Array.isArray(event.messages))compact.messages=compactAgentMessages(event.messages);
  return compact;
};
