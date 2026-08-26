import content from './SKILL.md?raw';
import runtimeReference from './references/widget-runtime.md?raw';

const body=content.replace(/^---\n[\s\S]*?\n---\n?/,'').trim();
const instructions=`${body}\n\n${runtimeReference.trim()}`;

export const createWidgetSkill=widgetStudio=>({
  name:'create-widget',
  description:'Create, inspect, modify, validate, install, update, and uninstall Future desktop widgets when the user asks for a new desktop component or wants to manage an existing generated widget.',
  content:instructions,
  filePath:'future://skills/create-widget/SKILL.md',
  tools:[widgetStudio.tool()],
});
