import content from './SKILL.md?raw';
import runtimeReference from './references/theme-runtime.md?raw';

const body=content.replace(/^---\n[\s\S]*?\n---\n?/,'').trim();
export const createThemeSkill=themeStudio=>({name:'create-theme',description:'Create, inspect, validate, preview, install, update, apply, and uninstall complete Aeris system themes.',content:`${body}\n\n${runtimeReference.trim()}`,filePath:'aeris://skills/create-theme/SKILL.md',tools:[themeStudio.tool()]});
