const INTERACTIVE = new Set(['less','man','more','nano','ssh','top','vi','vim','watch']);
const MUTATING = new Set(['cp','install','ln','mkdir','mv','rm','rmdir','tar','touch','unzip']);
const INPUT_REQUIRED = new Set(['ftp','passwd','su','telnet']);

const commandNames=value=>String(value||'')
  .split(/&&|\|\||[;|]/)
  .map(segment=>segment.trim().replace(/^(?:sudo\s+)+/,''))
  .map(segment=>segment.match(/^([^\s]+)/)?.[1]?.split('/').at(-1)||'')
  .filter(Boolean);

export function commandProfile(command){
  const trimmed=String(command).trim(),names=commandNames(trimmed),first=names[0]||'';
  const interactiveName=names.find(name=>INTERACTIVE.has(name)||INPUT_REQUIRED.has(name));
  const interactive=!!interactiveName||(first==='cat'&&!/^cat\s+\S/.test(trimmed));
  const mutatesFilesystem=names.some(name=>MUTATING.has(name))
    ||/(?:^|\s)sed\s+[^;|]*(?:^|\s)-i(?:\s|$)/.test(trimmed)
    ||/(^|[^>])>>?\s*[^&\s]/.test(trimmed);
  let timeout=30000;
  if(names.some(name=>['apk','curl','wget'].includes(name)))timeout=180000;
  else if(names.some(name=>['find','du','tar'].includes(name)))timeout=90000;
  return{name:interactiveName||first,interactive,mutatesFilesystem,timeout};
}
