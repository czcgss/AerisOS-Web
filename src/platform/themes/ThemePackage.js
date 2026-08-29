export const THEME_PACKAGE_FORMAT_VERSION=1;

const ID=/^[a-z][a-z0-9-]{1,47}$/;
const VERSION=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const HEX=/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const ICON_ID=/^[A-Za-z][A-Za-z0-9]{0,47}$/;
const SVG_PATH=/^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\-\s]+$/;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(`Invalid Future theme package: ${message}`)};
const localized=(value,field)=>{if(!plain(value))fail(`${field} must be a localized object`);const result=Object.fromEntries(Object.entries(value).map(([locale,text])=>[String(locale),String(text||'').trim()]).filter(([,text])=>text));if(!result.en||!result.zh)fail(`${field} requires en and zh values`);return result};
const color=(value,field)=>{const result=String(value||'').trim();if(!HEX.test(result))fail(`${field} must be a six or eight digit hex color`);return result};
const number=(value,field,min,max,fallback)=>{const result=value==null?fallback:Number(value);if(!Number.isFinite(result)||result<min||result>max)fail(`${field} must be between ${min} and ${max}`);return result};
const text=(value,field,max=120)=>{const result=String(value||'').trim();if(!result||result.length>max)fail(`${field} is required and may contain at most ${max} characters`);return result};
const background=value=>{const result=String(value||'').trim();if(!result||result.length>500)fail('wallpaper.background is required and may contain at most 500 characters');if(/url\s*\(|@import|expression\s*\(|javascript:|[<>"';{}]/i.test(result)||!/^[#(),.%\-\s\da-zA-Z]+$/.test(result))fail('wallpaper.background must be a safe color or gradient without resources, markup, or declarations');return result};
const iconGlyphs=value=>{if(value==null)return{};if(!plain(value))fail('icons.glyphs must be an object of icon id to SVG path data');const entries=Object.entries(value);if(entries.length>128)fail('icons.glyphs may contain at most 128 icons');let total=0;const result={};for(const [id,source]of entries){const path=String(source||'').trim();if(!ICON_ID.test(id))fail(`icons.glyphs contains an invalid icon id “${id}”`);if(!path||path.length>1600||!SVG_PATH.test(path)||!/^[Mm]/.test(path))fail(`icons.glyphs.${id} must be safe SVG path data beginning with M`);total+=path.length;if(total>64000)fail('icons.glyphs exceeds 64 KiB');result[id]=path}return result};

export function validateThemePackage(source){
  if(!plain(source)||!plain(source.manifest)||!plain(source.tokens))fail('manifest and tokens are required');
  const manifest=source.manifest,id=String(manifest.id||''),version=String(manifest.version||'');
  if(manifest.formatVersion!==THEME_PACKAGE_FORMAT_VERSION)fail(`unsupported formatVersion “${manifest.formatVersion}”`);
  if(!ID.test(id))fail('id must use lowercase letters, numbers, and hyphens');
  if(!VERSION.test(version))fail('version must use semantic versioning');
  const baseMode=String(manifest.baseMode||'light');if(!['light','dark'].includes(baseMode))fail('baseMode must be light or dark');
  const raw=source.tokens,colors=raw.colors,typography=raw.typography||{},shape=raw.shape||{},icons=raw.icons||{},material=raw.material||{},motion=raw.motion||{};
  if(!plain(colors))fail('tokens.colors is required');
  const tokens={
    colors:{accent:color(colors.accent,'colors.accent'),surface:color(colors.surface,'colors.surface'),surfaceElevated:color(colors.surfaceElevated,'colors.surfaceElevated'),text:color(colors.text,'colors.text'),muted:color(colors.muted,'colors.muted'),border:color(colors.border,'colors.border'),positive:color(colors.positive||'#4c9a72','colors.positive'),warning:color(colors.warning||'#cf8a45','colors.warning'),danger:color(colors.danger||'#c65d6d','colors.danger')},
    typography:{uiFont:text(typography.uiFont||'Manrope, "SF Pro Display", "Segoe UI", sans-serif','typography.uiFont',180),monoFont:text(typography.monoFont||'"Ubuntu Mono", ui-monospace, monospace','typography.monoFont',180),scale:number(typography.scale,'typography.scale',.85,1.25,1)},
    shape:{small:number(shape.small,'shape.small',2,16,7),medium:number(shape.medium,'shape.medium',6,24,12),large:number(shape.large,'shape.large',10,36,18),window:number(shape.window,'shape.window',8,32,18)},
    icons:{shape:['rounded','squircle','circle'].includes(icons.shape)?icons.shape:'squircle',scale:number(icons.scale,'icons.scale',.8,1.15,1),mode:icons.mode==='solid'?'solid':'outline',strokeWidth:number(icons.strokeWidth,'icons.strokeWidth',.8,3,1.8),linecap:['round','square','butt'].includes(icons.linecap)?icons.linecap:'round',linejoin:['round','bevel','miter'].includes(icons.linejoin)?icons.linejoin:'round',glyphs:iconGlyphs(icons.glyphs)},
    material:{blur:number(material.blur,'material.blur',0,48,24),saturation:number(material.saturation,'material.saturation',.6,1.8,1.2),transparency:number(material.transparency,'material.transparency',.65,1,.92),shadowStrength:number(material.shadowStrength,'material.shadowStrength',0,1.5,1)},
    motion:{scale:number(motion.scale,'motion.scale',0,1.5,1)},
  };
  const wallpaper=plain(source.wallpaper)?source.wallpaper:{};
  return{manifest:{formatVersion:THEME_PACKAGE_FORMAT_VERSION,id,version,name:localized(manifest.name,'name'),description:localized(manifest.description,'description'),author:text(manifest.author||'Future Community','author',80),baseMode},tokens,wallpaper:{background:background(wallpaper.background||'linear-gradient(145deg,#dce8ef,#cbdde8)'),preview:color(wallpaper.preview||tokens.colors.surface,'wallpaper.preview')}};
}

export function themeCssVariables(themePackage){const {tokens}=themePackage,{colors,typography,shape,icons,material,motion}=tokens,surfaceAlpha=colors.surface.length===9?parseInt(colors.surface.slice(7),16)/255:1,alpha=Math.round(surfaceAlpha*material.transparency*255).toString(16).padStart(2,'0'),surfaceBase=colors.surface.slice(0,7),iconRadius=icons.shape==='circle'?'50%':icons.shape==='rounded'?`${shape.small}px`:`${Math.max(shape.medium,12)}px`;return{
  '--accent':colors.accent,'--surface':colors.surface,'--surface-2':colors.surfaceElevated,'--text':colors.text,'--muted':colors.muted,'--line':colors.border,'--light':colors.surfaceElevated,'--dark':colors.muted,'--positive':colors.positive,'--warning':colors.warning,'--danger':colors.danger,
  '--font-ui':typography.uiFont,'--font-mono':typography.monoFont,'--font-scale':String(typography.scale),'--radius-sm':`${shape.small}px`,'--radius-md':`${shape.medium}px`,'--radius-lg':`${shape.large}px`,'--window-radius':`${shape.window}px`,
  '--icon-radius':iconRadius,'--icon-scale':String(icons.scale),'--glass-blur':`${material.blur}px`,'--glass-saturation':String(material.saturation),'--glass-opacity':String(material.transparency),'--theme-surface-alpha':`${surfaceBase}${alpha}`,'--shadow-strength':String(material.shadowStrength),'--shadow':`0 calc(18px * ${material.shadowStrength}) calc(42px * ${material.shadowStrength}) color-mix(in srgb,${colors.text} 22%,transparent)`,'--small-shadow':`0 calc(5px * ${material.shadowStrength}) calc(14px * ${material.shadowStrength}) color-mix(in srgb,${colors.text} 16%,transparent)`,'--inset':`inset 0 1px color-mix(in srgb,${colors.surfaceElevated} 72%,transparent)`,'--motion-scale':String(motion.scale),'--theme-wallpaper':themePackage.wallpaper.background,
}}
