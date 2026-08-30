import {migrate as migrateCalendar} from '../../apps/calendar/model.js';

const enc=value=>encodeURIComponent(String(value));
const dec=value=>decodeURIComponent(String(value));
const text=value=>String(value||'');
const includes=(source,query)=>!query||text(source).toLowerCase().includes(query.toLowerCase());
const action=(id,label,tool,operation,targetParam,risk='safe',parameters={})=>({id,label,tool,operation,targetParam,risk,mutates:true,parameters});

const calendarEvent=event=>({
  uri:`future://calendar/event/${enc(event.id)}`,type:'calendar.event',appId:'calendar',id:String(event.id),title:event.title||'Untitled event',subtitle:[event.start,event.location].filter(Boolean).join(' · '),
  properties:{start:event.start,end:event.end,allDay:!!event.allDay,calendarId:event.calendarId||'personal',location:event.location||'',notes:text(event.notes).slice(0,4000),notesTruncated:text(event.notes).length>4000,repeat:event.repeat||'none',alert:event.alert||'none'},
  relationships:event.start?[{predicate:'occursOn',target:`future://calendar/date/${event.start.slice(0,10)}`}]:[],
  actions:[action('calendar.event.delete','Delete calendar event','future_calendar','delete_event','eventId','high',{title:event.title||''})],
});
const calendarDate=date=>({uri:`future://calendar/date/${date}`,type:'calendar.date',appId:'calendar',id:date,title:date,properties:{date},relationships:[],actions:[]});

export const createCalendarEntityProviders=userdata=>{
  const load=()=>userdata.load('calendar',null).then(migrateCalendar);
  return[
    {type:'calendar.event',appId:'calendar',label:'Calendar events',owns:uri=>/^future:\/\/calendar\/event\/[^/]+$/.test(uri),async search({query,filters,limit}){const state=await load(),date=text(filters.date);return state.events.filter(event=>(!date||event.start.startsWith(date))&&includes(`${event.title} ${event.location} ${event.notes} ${event.attendees}`,query)).slice(0,limit).map(calendarEvent)},async get(uri){const id=dec(uri.split('/').at(-1)),state=await load(),event=state.events.find(item=>String(item.id)===id);return event?calendarEvent(event):null},async related(entity){return entity.properties.start?[calendarDate(entity.properties.start.slice(0,10))]:[]}},
    {type:'calendar.date',appId:'calendar',label:'Calendar dates',owns:uri=>/^future:\/\/calendar\/date\/\d{4}-\d{2}-\d{2}$/.test(uri),async search({query,filters,limit}){const state=await load(),dates=[...new Set(state.events.map(event=>event.start?.slice(0,10)).filter(Boolean))].filter(date=>(!filters.date||date===filters.date)&&includes(date,query));return dates.slice(0,limit).map(calendarDate)},async get(uri){const date=uri.split('/').at(-1);return /^\d{4}-\d{2}-\d{2}$/.test(date)?calendarDate(date):null},async related(entity,{limit}){const state=await load();return state.events.filter(event=>event.start?.startsWith(entity.id)).slice(0,limit).map(calendarEvent)}},
  ];
};

const noteEntity=(note,{full=false}={})=>{const content=text(note.content),limit=full?12000:600;return{uri:`future://notes/${enc(note.id)}`,type:'note',appId:'notes',id:String(note.id),title:note.title||'Untitled note',subtitle:content.replace(/\s+/g,' ').slice(0,180),properties:{content:content.slice(0,limit),truncated:content.length>limit,pinned:!!note.pinned},updatedAt:Number(note.updatedAt)||0,relationships:[],actions:[action('note.delete','Delete note','future_notes','delete','noteId','high',{title:note.title||''})]}};
export const createNotesEntityProvider=userdata=>({type:'note',appId:'notes',label:'Notes',owns:uri=>/^future:\/\/notes\/[^/]+$/.test(uri),async search({query,limit}){return(await userdata.load('notes',[])).filter(note=>includes(`${note.title} ${note.content}`,query)).slice(0,limit).map(note=>noteEntity(note))},async get(uri){const id=dec(uri.split('/').at(-1)),note=(await userdata.load('notes',[])).find(item=>String(item.id)===id);return note?noteEntity(note,{full:true}):null}});

const reminderEntity=item=>({uri:`future://reminders/${enc(item.id)}`,type:'reminder',appId:'reminders',id:String(item.id),title:item.title||'Untitled reminder',subtitle:[item.due,item.dueTime].filter(Boolean).join(' '),properties:{due:item.due||'',dueTime:item.dueTime||'',done:!!item.done,priority:!!item.priority,notify:item.notify!==false&&!!item.due},createdAt:Number(item.createdAt)||0,relationships:item.due?[{predicate:'dueOn',target:`future://calendar/date/${item.due}`}]:[],actions:item.done?[]:[action('reminder.complete','Complete reminder','future_reminders','complete','reminderId')]});
export const createRemindersEntityProvider=userdata=>({type:'reminder',appId:'reminders',label:'Reminders',owns:uri=>/^future:\/\/reminders\/[^/]+$/.test(uri),async search({query,filters,limit}){return(await userdata.load('reminders',[])).filter(item=>(filters.includeCompleted||!item.done)&&(!filters.date||item.due===filters.date)&&includes(item.title,query)).slice(0,limit).map(reminderEntity)},async get(uri){const id=dec(uri.split('/').at(-1)),item=(await userdata.load('reminders',[])).find(entry=>String(entry.id)===id);return item?reminderEntity(item):null}});
