import content from './SKILL.md?raw';
import runtimeReference from './references/skill-runtime.md?raw';

const body=content.replace(/^---\n[\s\S]*?\n---\n?/,'').trim();

export const skillCreatorSkill=skillStudio=>({
  name:'skill-creator',
  description:'Create, inspect, validate, install, update, enable, and disable Future Agent Skills when the user asks to add a reusable workflow, knowledge pack, or Python-assisted capability.',
  content:`${body}\n\n${runtimeReference.trim()}`,
  filePath:'future://skills/skill-creator/SKILL.md',
  tools:[skillStudio.tool()],
});
