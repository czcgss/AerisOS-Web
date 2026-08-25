import { loadPyodide, version as pyodideVersion } from 'pyodide';

const PYODIDE_INDEX_URL=`https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;
let runtime=null;
const send=(type,payload={})=>postMessage({type,...payload});
const text=value=>typeof value==='string'?value:new TextDecoder().decode(value);

const prepare=async id=>{
  if(runtime)return runtime;
  send('status',{id,phase:'preparing',message:'Preparing Python runtime'});
  runtime=await loadPyodide({indexURL:PYODIDE_INDEX_URL,stdout:()=>{},stderr:()=>{}});
  return runtime;
};

const safePath=value=>{
  const path=String(value||'').replace(/\\/g,'/').replace(/^\/+/,''),parts=path.split('/');
  if(!path||parts.some(part=>!part||part==='.'||part==='..'))throw new Error(`Invalid Skill resource path: ${value}`);
  return path;
};

const execute=async message=>{
  const {id,skill,script,input,files}=message,pyodide=await prepare(id),stdout=[],stderr=[];
  pyodide.setStdout({batched:value=>stdout.push(value)});
  pyodide.setStderr({batched:value=>stderr.push(value)});
  const source=files[script]?text(files[script]):'';
  if(!source)throw new Error(`Python script was not found: ${script}`);
  const pythonSources=Object.entries(files).filter(([path])=>/\.py$/i.test(path)).map(([,content])=>text(content));
  if(pythonSources.some(code=>/(^|\n)\s*(?:from|import)\s+(?:js|pyodide|micropip|webbrowser|socket|subprocess)(?:\s|\.|$)/m.test(code)))throw new Error('This Python Skill imports a browser or process capability that Future does not expose.');
  send('status',{id,phase:'packages',message:'Loading Python packages'});
  await pyodide.loadPackagesFromImports(pythonSources.join('\n'),{messageCallback:message=>send('status',{id,phase:'packages',message})});
  const root=`/future-skills/${String(skill).replace(/[^a-z0-9-]/g,'-')}/${id}`;
  pyodide.FS.mkdirTree(root);
  for(const [path,content] of Object.entries(files)){
    const relative=safePath(path),target=`${root}/${relative}`,directory=target.split('/').slice(0,-1).join('/');
    pyodide.FS.mkdirTree(directory);if(typeof content==='string')pyodide.FS.writeFile(target,content,{encoding:'utf8'});else pyodide.FS.writeFile(target,content);
  }
  pyodide.globals.set('__future_skill_root',root);
  pyodide.globals.set('__future_script_path',safePath(script));
  pyodide.globals.set('__future_input_json',JSON.stringify(input??{}));
  send('status',{id,phase:'running',message:'Running Python script'});
  const value=await pyodide.runPythonAsync(`
import asyncio
import inspect
import json
import os
import runpy
import sys

_skill_root = __future_skill_root
_script_file = os.path.join(_skill_root, __future_script_path)
if _skill_root not in sys.path:
    sys.path.insert(0, _skill_root)
_previous_cwd = os.getcwd()
os.chdir(_skill_root)
_future_result_json = "null"
try:
    _namespace = runpy.run_path(_script_file, run_name="__future_skill__")
    _entry = _namespace.get("main")
    _input = json.loads(__future_input_json)
    if callable(_entry):
        _value = _entry(_input)
        if inspect.isawaitable(_value):
            _value = await _value
    else:
        _value = _namespace.get("result")
    if hasattr(_value, "to_dict"):
        try:
            _value = _value.to_dict(orient="records")
        except TypeError:
            _value = _value.to_dict()
    elif hasattr(_value, "tolist"):
        _value = _value.tolist()
    _future_result_json = json.dumps(_value, ensure_ascii=False, default=str)
finally:
    os.chdir(_previous_cwd)
_future_result_json
`,{filename:`future://${skill}/${script}`});
  return{value:JSON.parse(String(value??'null')),stdout:stdout.join('\n').slice(0,12000),stderr:stderr.join('\n').slice(0,12000)};
};

self.onmessage=async event=>{
  const message=event.data||{};
  if(message.type!=='execute')return;
  try{send('result',{id:message.id,result:await execute(message)})}
  catch(error){send('error',{id:message.id,error:error?.message||String(error),stack:error?.stack||''})}
};
