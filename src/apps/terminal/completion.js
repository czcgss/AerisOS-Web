export const TERMINAL_COMMANDS = [
  'apk','cat','cd','clear','cp','date','df','du','echo','env','exit','find','free','grep','head','ip','ls','mkdir','mv','ping','printf','ps','pwd','rm','rmdir','sed','tail','tar','touch','uname','wc','which','whoami',
];

export const decodeCompletionToken=value=>String(value||'').replace(/^(['"])(.*)\1$/,'$2').replace(/\\([\\\s'"$])/g,'$1');
export const escapeCompletionToken=value=>String(value).replace(/([\\\s'"$])/g,'\\$1');

const tokenStart=(value,caret)=>{
  let quote='',escaped=false,start=0;
  for(let index=0;index<caret;index++){
    const character=value[index];
    if(escaped){escaped=false;continue}
    if(character==='\\'){escaped=true;continue}
    if(quote){if(character===quote)quote='';continue}
    if(character==='"'||character==="'"){quote=character;continue}
    if(/\s/.test(character))start=index+1;
  }
  return start;
};

export const normalizeCompletionPath=value=>{
  const absolute=value.startsWith('/'),parts=[];
  for(const part of value.split('/')){
    if(!part||part==='.')continue;
    if(part==='..'){parts.pop();continue}
    parts.push(part);
  }
  return `${absolute?'/':''}${parts.join('/')}`||'/';
};

export function completionTarget(value,caret,cwd,home){
  const start=tokenStart(value,caret),raw=value.slice(start,caret),token=decodeCompletionToken(raw),before=value.slice(0,start).trim(),command=before.split(/\s+/)[0]||'';
  const commandMode=!before&&!/^[./~]/.test(token);
  if(commandMode)return{kind:'command',start,end:caret,token,prefix:token};
  const slash=token.lastIndexOf('/'),directoryToken=slash>=0?token.slice(0,slash+1):'',namePrefix=slash>=0?token.slice(slash+1):token;
  let directory;
  if(!directoryToken)directory=cwd;
  else if(directoryToken==='~/')directory=home;
  else if(directoryToken.startsWith('~/'))directory=normalizeCompletionPath(`${home}/${directoryToken.slice(2)}`);
  else if(directoryToken.startsWith('/'))directory=normalizeCompletionPath(directoryToken);
  else directory=normalizeCompletionPath(`${cwd}/${directoryToken}`);
  return{kind:'path',start,end:caret,token,prefix:namePrefix,directoryToken,directory,command,directoriesOnly:command==='cd'};
}

export function commandCandidates(target){
  const prefix=target.prefix.toLowerCase();
  return TERMINAL_COMMANDS.filter(name=>name.startsWith(prefix)).map(name=>({name,label:name,insert:`${name} `,type:'command'}));
}

export function pathCandidates(target,entries){
  const prefix=target.prefix.toLowerCase();
  return entries.filter(entry=>(!target.directoriesOnly||entry.type==='directory')&&entry.name.toLowerCase().startsWith(prefix)).sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='directory'?-1:1).map(entry=>{
    const suffix=entry.type==='directory'?'/':' ';
    return{name:entry.name,label:`${entry.name}${entry.type==='directory'?'/':''}`,insert:`${escapeCompletionToken(target.directoryToken)}${escapeCompletionToken(entry.name)}${suffix}`,type:entry.type,entry};
  });
}

export function commonPrefix(values){
  if(!values.length)return'';
  let prefix=values[0];
  for(const value of values.slice(1)){while(prefix&&!value.startsWith(prefix))prefix=prefix.slice(0,-1)}
  return prefix;
}

export function replaceCompletion(value,target,replacement){return `${value.slice(0,target.start)}${replacement}${value.slice(target.end)}`}
