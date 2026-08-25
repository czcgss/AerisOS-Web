import content from './SKILL.md?raw';
import runtimeReference from './references/app-runtime.md?raw';

const body=content.replace(/^---\n[\s\S]*?\n---\n?/,'').trim();
const instructions=`${body}\n\n${runtimeReference.trim()}`;

export const createAppSkill=(appStudio,queryUser)=>({
  name:'create-app',
  description:'Create, inspect, modify, validate, install, update, and uninstall Future extension apps when the user asks to build, add, extend, change, manage, or remove an app.',
  content:instructions,
  filePath:'future://skills/create-app/SKILL.md',
  tools:[queryUser.tool(),appStudio.tool()],
});
