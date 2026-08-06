export const COLORS=['#5f87d7','#d36f91','#4c9a86','#d18a55','#7c6dd9','#c75f62'];
export const pad=value=>String(value).padStart(2,'0');
export const dateKey=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
export const localDateTime=date=>`${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
export const parseLocal=value=>{const [date,time='00:00']=String(value).split('T'),[year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);return new Date(year,month-1,day,hour||0,minute||0)};
export const addDays=(date,days)=>{const copy=new Date(date);copy.setDate(copy.getDate()+days);return copy};
export const startOfWeek=date=>addDays(new Date(date.getFullYear(),date.getMonth(),date.getDate()),-date.getDay());
export const startOfMonth=date=>new Date(date.getFullYear(),date.getMonth(),1);
export const endOfMonth=date=>new Date(date.getFullYear(),date.getMonth()+1,0,23,59,59);
export const duration=event=>Math.max(30*60000,parseLocal(event.end)-parseLocal(event.start));

export function createEvent(date=new Date(),calendarId='personal'){
  const start=new Date(date);start.setSeconds(0,0);start.setMinutes(start.getMinutes()<30?30:0);if(start.getMinutes()===0&&date.getMinutes()>=30)start.setHours(start.getHours()+1);
  const end=new Date(start.getTime()+60*60000);
  return{id:crypto.randomUUID(),title:'',calendarId,start:localDateTime(start),end:localDateTime(end),allDay:false,location:'',notes:'',url:'',attendees:'',repeat:'none',alert:'15m'};
}

export function migrate(value){
  const defaults=[{id:'personal',name:'Personal',color:COLORS[0],visible:true},{id:'work',name:'Work',color:COLORS[2],visible:true},{id:'birthdays',name:'Birthdays',color:COLORS[1],visible:true,readOnly:true},{id:'holidays',name:'Holidays',color:'#e38b3b',visible:true,readOnly:true}];
  if(value&&Array.isArray(value.calendars)&&Array.isArray(value.events)){const calendars=value.calendars.map((calendar,index)=>({...calendar,color:calendar.color||COLORS[index%COLORS.length],visible:calendar.visible!==false}));for(const calendar of defaults)if(!calendars.some(item=>item.id===calendar.id))calendars.push(calendar);return{calendars,events:value.events.map(normalize)}}
  const legacy=Array.isArray(value)?value:[];
  return{calendars:defaults,events:legacy.map(item=>normalize({...item,calendarId:'personal',start:`${item.date}T09:00`,end:`${item.date}T10:00`}))};
}

export function normalize(event){
  const start=event.start||`${event.date||dateKey(new Date())}T09:00`,end=event.end||localDateTime(new Date(parseLocal(start).getTime()+60*60000));
  return{id:event.id||crypto.randomUUID(),title:event.title||'',calendarId:event.calendarId||'personal',start,end,allDay:!!event.allDay,location:event.location||'',notes:event.notes||'',url:event.url||'',attendees:event.attendees||'',repeat:event.repeat||'none',alert:event.alert||'none'};
}

const advance=(date,repeat)=>{const next=new Date(date);if(repeat==='daily')next.setDate(next.getDate()+1);if(repeat==='weekly')next.setDate(next.getDate()+7);if(repeat==='monthly')next.setMonth(next.getMonth()+1);if(repeat==='yearly')next.setFullYear(next.getFullYear()+1);return next};
export function occurrences(events,calendars,rangeStart,rangeEnd,query=''){
  const visible=new Set(calendars.filter(calendar=>calendar.visible!==false).map(calendar=>calendar.id)),needle=query.trim().toLowerCase(),result=[];
  for(const event of events){
    if(!visible.has(event.calendarId)||needle&&!`${event.title} ${event.location} ${event.notes} ${event.attendees}`.toLowerCase().includes(needle))continue;
    const baseStart=parseLocal(event.start),baseEnd=parseLocal(event.end),span=Math.max(0,baseEnd-baseStart);let current=baseStart,guard=0;
    if(event.repeat!=='none'&&current<rangeStart){const day=86400000;if(event.repeat==='daily')current.setDate(current.getDate()+Math.max(0,Math.floor((rangeStart-current)/day)-1));if(event.repeat==='weekly')current.setDate(current.getDate()+Math.max(0,Math.floor((rangeStart-current)/(day*7))-1)*7);if(event.repeat==='monthly'){const months=(rangeStart.getFullYear()-current.getFullYear())*12+rangeStart.getMonth()-current.getMonth();current.setMonth(current.getMonth()+Math.max(0,months-1))}if(event.repeat==='yearly')current.setFullYear(current.getFullYear()+Math.max(0,rangeStart.getFullYear()-current.getFullYear()-1))}
    while(current<=rangeEnd&&guard++<740){const currentEnd=new Date(current.getTime()+span);if(currentEnd>=rangeStart)result.push({...event,occurrenceStart:new Date(current),occurrenceEnd:currentEnd,occurrenceKey:`${event.id}:${localDateTime(current)}`});if(event.repeat==='none')break;current=advance(current,event.repeat)}
  }
  return result.sort((a,b)=>a.occurrenceStart-b.occurrenceStart||a.title.localeCompare(b.title));
}

export function moveEvent(event,targetDate,targetMinutes=null){
  const start=parseLocal(event.start),span=duration(event),target=parseLocal(`${targetDate}T00:00`);if(targetMinutes===null)target.setHours(start.getHours(),start.getMinutes());else target.setMinutes(targetMinutes);event.start=localDateTime(target);event.end=localDateTime(new Date(target.getTime()+span));return event;
}
