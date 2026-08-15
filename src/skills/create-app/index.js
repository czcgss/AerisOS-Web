import content from './SKILL.md?raw';

const body=content.replace(/^---\n[\s\S]*?\n---\n?/,'').trim();

export const createAppSkill=appStudio=>({
  name:'create-app',
  description:'Create, inspect, modify, validate, install, update, and uninstall Aeris extension apps when the user asks to build, add, extend, change, manage, or remove an app.',
  content:body,
  filePath:'aeris://skills/create-app/SKILL.md',
  tools:[appStudio.tool()],
});
