import { icon } from '../../icons.js';

export const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const pad=value=>String(value).padStart(2,'0');
export const dateKey=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
export const appShell=(app,context,body,actions='')=>`<div class="activity-surface activity-${app.id}">
  <header><span class="app-icon app-icon-${esc(app.color||'grey')}">${icon(app.icon,17)}</span><div><strong>${esc(context.i18n.t(app.title))}</strong><small>${esc(context.i18n.t('activityCompactView'))}</small></div>${actions}</header>
  <main>${body}</main>
</div>`;
export const empty=(glyph,title,copy='')=>`<div class="activity-surface-empty"><span>${icon(glyph,25)}</span><strong>${esc(title)}</strong>${copy?`<p>${esc(copy)}</p>`:''}</div>`;
export const fullAppButton=(appId,i18n)=>`<button data-activity-full-app="${esc(appId)}" title="${esc(i18n.t('openInApp'))}">${icon('maximize',13)}</button>`;
export const bindFullApp=(root,appId,context)=>root.querySelector('[data-activity-full-app]')?.addEventListener('click',()=>context.openFullApp(appId));
export const formatDate=(value,i18n,options={weekday:'short',month:'short',day:'numeric'})=>new Intl.DateTimeFormat(i18n.t('dateFormat'),options).format(value);

