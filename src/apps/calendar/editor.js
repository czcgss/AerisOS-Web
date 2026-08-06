import {COLORS,parseLocal,dateKey,localDateTime} from './model.js';
const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');

export function eventEditor(event,calendars,i18n){
  const start=parseLocal(event.start),end=parseLocal(event.end),color=calendars.find(item=>item.id===event.calendarId)?.color||COLORS[0];
  const calendarOptions=calendars.filter(item=>!item.readOnly).map(item=>`<option value="${item.id}" ${item.id===event.calendarId?'selected':''}>${esc(item.customName||item.name)}</option>`).join('');
  const options=(values,prefix='')=>values.map(value=>`<option value="${value}" ${event[prefix||'repeat']===value?'selected':''}>${i18n.t(prefix?`${prefix}_${value}`:value)}</option>`).join('');
  return `<section class="calendar-editor-layer" data-editor-side="right"><form class="calendar-event-editor calendar-quick-card" data-event-form autocomplete="off" novalidate>
    <header><i style="--event-color:${color}"></i><input name="title" value="${esc(event.title)}" placeholder="${i18n.t('eventTitle')}"><button type="button" data-editor-cancel aria-label="${i18n.t('close')}">×</button></header>
    <div class="event-editor-scroll">
      <label class="quick-calendar-row"><span>${i18n.t('calendar')}</span><select name="calendarId">${calendarOptions}</select></label>
      <label class="quick-toggle-row"><span>${i18n.t('allDay')}</span><input name="allDay" type="checkbox" ${event.allDay?'checked':''}></label>
      <div class="quick-date-row"><span>${i18n.t('date')}</span><input name="startDate" type="date" value="${dateKey(start)}"><span class="quick-date-separator">–</span><input name="endDate" type="date" value="${dateKey(end)}"></div>
      <div class="quick-time-row"><span>${i18n.t('time')}</span><input name="startTime" type="time" value="${localDateTime(start).slice(11)}" ${event.allDay?'disabled':''}><span>–</span><input name="endTime" type="time" value="${localDateTime(end).slice(11)}" ${event.allDay?'disabled':''}></div>
      <label><span>${i18n.t('repeat')}</span><select name="repeat">${options(['none','daily','weekly','monthly','yearly'])}</select></label>
      <label><span>${i18n.t('alert')}</span><select name="alert">${['none','atTime','5m','15m','1h','1d'].map(value=>`<option value="${value}" ${event.alert===value?'selected':''}>${i18n.t(`alert_${value}`)}</option>`).join('')}</select></label>
      <label class="quick-location-row"><span>${i18n.t('location')}</span><input name="location" value="${esc(event.location)}" placeholder="${i18n.t('addLocation')}"></label>
    </div>
    <footer>${event.persisted?`<button type="button" class="danger" data-editor-delete>${i18n.t('delete')}</button>`:'<span></span>'}<div><button type="button" data-editor-cancel>${i18n.t('cancel')}</button><button type="button" class="primary" data-editor-save>${i18n.t('save')}</button></div></footer>
  </form></section>`;
}

export function readEventForm(form,event){
  const data=new FormData(form),allDay=data.get('allDay')==='on',startTime=allDay?'00:00':data.get('startTime')||'09:00',endTime=allDay?'23:59':data.get('endTime')||'10:00',start=`${data.get('startDate')}T${startTime}`,candidateEnd=`${data.get('endDate')}T${endTime}`,end=parseLocal(candidateEnd)>parseLocal(start)?candidateEnd:localDateTime(new Date(parseLocal(start).getTime()+60*60000));
  return{...event,title:String(data.get('title')).trim(),calendarId:String(data.get('calendarId')),allDay,start,end,repeat:String(data.get('repeat')),alert:String(data.get('alert')),location:String(data.get('location')).trim()};
}
