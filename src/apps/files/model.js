export const HOME='/home/future';
export const SHARED='/mnt/future';
export const TRASH='/home/future/.local/share/Trash/files';

export const LOCATIONS=[
  {key:'home',path:HOME,icon:'home',section:'favorites'},
  {key:'desktop',path:`${HOME}/Desktop`,icon:'desktop',section:'favorites'},
  {key:'documents',path:`${HOME}/Documents`,icon:'document',section:'favorites'},
  {key:'downloads',path:`${HOME}/Downloads`,icon:'download',section:'favorites'},
  {key:'pictures',path:`${HOME}/Pictures`,icon:'image',section:'favorites'},
  {key:'music',path:`${SHARED}/Music`,icon:'music',section:'favorites'},
  {key:'shared',path:SHARED,icon:'disk',section:'locations'},
  {key:'trash',path:TRASH,icon:'delete',section:'locations'}
];

export const escapeHtml=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const joinPath=(path,name)=>`${path.replace(/\/$/,'')}/${name}`;

const image=/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const video=/\.(mp4|mkv|mov|webm|avi)$/i;
const audio=/\.(mp3|wav|flac|m4a|ogg)$/i;
const archive=/\.(zip|tar|tgz|gz|bz2|xz|7z|apk)$/i;
const code=/\.(js|mjs|ts|tsx|jsx|css|html|json|py|sh|c|cpp|h|rs|go|java|md|yml|yaml)$/i;
const document=/\.(txt|rtf|pdf|docx?|odt|pages|csv|xlsx?|numbers|pptx?|key)$/i;

export function fileKind(entry){
  if(entry.type==='directory')return{key:'folder',glyph:'folder',className:'folder'};
  const name=entry.name||'';
  if(image.test(name))return{key:'imageFile',glyph:'image',className:'image'};
  if(video.test(name))return{key:'videoFile',glyph:'play',className:'video'};
  if(audio.test(name))return{key:'audioFile',glyph:'volume',className:'audio'};
  if(archive.test(name))return{key:'archiveFile',glyph:'package',className:'archive'};
  if(code.test(name))return{key:'sourceFile',glyph:'terminal',className:'code'};
  if(document.test(name))return{key:'documentFile',glyph:'document',className:'document'};
  return{key:'file',glyph:'document',className:'generic'};
}

export function formatSize(bytes=0){
  if(!Number(bytes))return'—';
  const units=['B','KB','MB','GB'];let value=Number(bytes),unit=0;
  while(value>=1024&&unit<units.length-1){value/=1024;unit++}
  return`${value<10&&unit?value.toFixed(1):Math.round(value)} ${units[unit]}`;
}

export function formatDate(timestamp,locale='en-US'){
  if(!timestamp)return'—';
  return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(timestamp*1000));
}

export function compareEntries(a,b,key,direction=1){
  if(a.type!==b.type)return a.type==='directory'?-1:1;
  if(key==='size'||key==='modified')return((Number(a[key])||0)-(Number(b[key])||0))*direction;
  if(key==='kind')return fileKind(a).key.localeCompare(fileKind(b).key)*direction;
  return String(a.name).localeCompare(String(b.name),undefined,{numeric:true,sensitivity:'base'})*direction;
}
