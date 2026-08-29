import test from 'node:test';
import assert from 'node:assert/strict';
import {MultiAgentOrchestratorService} from '../../src/services/MultiAgentOrchestratorService.js';

test('main Agent capability directory follows live Agent, Tool, and Skill configuration',()=>{
  let agents=[
    {id:'research',name:'Research',description:'Understands external information.',toolApps:['browser'],skills:['web-research'],enabled:true},
    {id:'computer',name:'Computer',description:'Operates the Linux guest.',toolApps:['terminal'],skills:[],enabled:true},
  ];
  const enabledApps=new Set(['browser','terminal']),registry={list:()=>structuredClone(agents)},toolService={
    apps:()=>[{id:'browser',title:'webBrowser'},{id:'terminal',title:'terminal'}],
    list:()=>[
      {appId:'browser',operation:'navigate',label:'Navigate browser',description:'Open a URL.',risk:'safe'},
      {appId:'browser',operation:'extract_content',label:'Read browser page content',description:'Read the page.',risk:'safe'},
      {appId:'terminal',operation:'run_command',label:'Run terminal command',description:'Run Linux commands.',risk:'high'},
    ],
  },skillRegistry={list:()=>[{name:'web-research',description:'Research and compare web sources.',enabled:true,toolCount:1}]};
  const service=new MultiAgentOrchestratorService({registry,toolService,skillRegistry,isToolAppEnabled:id=>enabledApps.has(id),storage:null});
  const initial=service.directory(),research=initial.find(agent=>agent.id==='research');assert.deepEqual(research.toolApps,['browser']);assert.deepEqual(research.skills,['web-research']);assert.deepEqual(research.appCapabilities[0].operations.map(item=>item.operation),['extract_content','navigate']);
  const prompt=service.prompt();assert.match(prompt,/research \(Research\)[\s\S]*browser: extract_content \(Read browser page content\), navigate \(Navigate browser\)/);assert.match(prompt,/web-research: Research and compare web sources/);assert.match(service.mainTool('session',()=> 'turn').description,/Live Agent capability directory:[\s\S]*browser: extract_content/);
  enabledApps.delete('browser');assert.deepEqual(service.directory().find(agent=>agent.id==='research').toolApps,[]);assert.match(service.prompt(),/research \(Research\)[\s\S]*Effective app tools:\n    - none/);
  agents=agents.map(agent=>agent.id==='research'?{...agent,toolApps:['terminal'],skills:[]}:agent);assert.deepEqual(service.directory().find(agent=>agent.id==='research').toolApps,['terminal']);
});
