const MAX_FILES=5,MAX_IMAGE_BYTES=5*1024*1024,MAX_TEXT_BYTES=512*1024,MAX_TEXT_TOTAL_BYTES=1024*1024,MAX_TOTAL_BYTES=8*1024*1024;
const TEXT_EXTENSIONS=new Set(['txt','md','markdown','json','csv','tsv','xml','yaml','yml','js','mjs','cjs','ts','tsx','jsx','css','html','htm','py','sh','sql','log','ini','toml']);

export const AGENT_ATTACHMENT_ACCEPT='image/*,.txt,.md,.markdown,.json,.csv,.tsv,.xml,.yaml,.yml,.js,.mjs,.cjs,.ts,.tsx,.jsx,.css,.html,.htm,.py,.sh,.sql,.log,.ini,.toml';

const extension=name=>String(name||'').split('.').pop()?.toLowerCase()||'';
const isTextFile=file=>String(file.type||'').startsWith('text/')||['application/json','application/xml','application/javascript','application/typescript'].includes(file.type)||TEXT_EXTENSIONS.has(extension(file.name));
const base64=bytes=>{let value='';const chunk=0x8000;for(let offset=0;offset<bytes.length;offset+=chunk)value+=String.fromCharCode(...bytes.subarray(offset,offset+chunk));return btoa(value)};
const fail=(key,message,name='')=>{const error=new Error(message);error.attachmentKey=key;error.attachmentName=name;throw error};

export const attachmentErrorMessage=(error,i18n)=>error?.attachmentKey?i18n.t(error.attachmentKey).replace('{name}',error.attachmentName||''):error?.message||i18n.t('attachmentUploadFailed');

export function validateAgentAttachments(attachments){
  const selected=[...(attachments||[])];
  if(selected.length>MAX_FILES)fail('attachmentLimitCount',`Attach at most ${MAX_FILES} files at a time.`);
  if(selected.reduce((sum,file)=>sum+Number(file.size||0),0)>MAX_TOTAL_BYTES)fail('attachmentLimitTotal','Attachments may contain at most 8 MB in total.');
  if(selected.filter(file=>file.kind==='text'||isTextFile(file)).reduce((sum,file)=>sum+Number(file.size||0),0)>MAX_TEXT_TOTAL_BYTES)fail('attachmentLimitTextTotal','Text attachments may contain at most 1 MB in total.');
  return selected;
}

export async function readAgentAttachments(files){
  const selected=validateAgentAttachments(files);
  return Promise.all(selected.map(async file=>{
    const mimeType=String(file.type||'')||'application/octet-stream',common={id:crypto.randomUUID(),name:String(file.name||'attachment'),mimeType,size:Number(file.size)||0};
    if(mimeType.startsWith('image/')){
      if(file.size>MAX_IMAGE_BYTES)fail('attachmentImageTooLarge',`“${file.name}” is larger than the 5 MB image limit.`,file.name);
      return{...common,kind:'image',data:base64(new Uint8Array(await file.arrayBuffer()))};
    }
    if(!isTextFile(file))fail('attachmentUnsupported',`“${file.name}” is not a supported image or text file.`,file.name);
    if(file.size>MAX_TEXT_BYTES)fail('attachmentTextTooLarge',`“${file.name}” is larger than the 512 KB text-file limit.`,file.name);
    return{...common,kind:'text',text:await file.text()};
  }));
}

export const attachmentMetadata=attachments=>(attachments||[]).map(({id,name,mimeType,size,kind})=>({id,name,mimeType,size,kind}));

export function agentAttachmentInput(prompt,attachments=[]){
  const selected=validateAgentAttachments(attachments),images=selected.filter(item=>item.kind==='image').map(item=>({type:'image',data:item.data,mimeType:item.mimeType}));
  const documents=selected.filter(item=>item.kind==='text');
  let text=String(prompt||'').trim();
  if(!text)text='Analyze the attached file or files.';
  const documentBlocks=documents.map(item=>({type:'text',text:`<attachment name="${item.name.replace(/["<>]/g,'')}" type="${item.mimeType.replace(/["<>]/g,'')}">\n${item.text}\n</attachment>`}));
  return{content:images.length||documentBlocks.length?[{type:'text',text},...documentBlocks,...images]:text,images};
}

export function compactAttachmentMessages(messages){
  const copy=structuredClone(messages||[]);
  for(const message of copy){
    if(message?.role!=='user'||!Array.isArray(message.content))continue;
    const imageCount=message.content.filter(block=>block?.type==='image').length;
    const documentCount=message.content.filter(block=>block?.type==='text'&&/^<attachment\s/i.test(String(block.text||''))).length;
    message.content=message.content.filter(block=>block?.type!=='image'&&!(block?.type==='text'&&/^<attachment\s/i.test(String(block.text||''))));
    if(imageCount)message.content.push({type:'text',text:`[${imageCount} image attachment${imageCount===1?'':'s'} available in the original turn]`});
    if(documentCount)message.content.push({type:'text',text:`[${documentCount} text attachment${documentCount===1?'':'s'} available in the original turn]`});
  }
  return copy;
}

export function compactAttachmentsForStorage(state){
  const copy=structuredClone(state);
  for(const session of copy.sessions||[])session.messages=compactAttachmentMessages(session.messages);
  return copy;
}
