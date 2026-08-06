import {dateKey} from './model.js';
const nth=(year,month,weekday,n)=>{const date=new Date(year,month,1);date.setDate(1+(7+weekday-date.getDay())%7+(n-1)*7);return dateKey(date)};
const last=(year,month,weekday)=>{const date=new Date(year,month+1,0);date.setDate(date.getDate()-(7+date.getDay()-weekday)%7);return dateKey(date)};
const cn={
  2025:[['2025-01-29','春节'],['2025-04-04','清明节'],['2025-05-01','劳动节'],['2025-05-31','端午节'],['2025-10-01','国庆节'],['2025-10-06','中秋节']],
  2026:[['2026-02-17','春节'],['2026-04-05','清明节'],['2026-05-01','劳动节'],['2026-06-19','端午节'],['2026-09-25','中秋节'],['2026-10-01','国庆节']],
  2027:[['2027-02-06','春节'],['2027-04-05','清明节'],['2027-05-01','劳动节'],['2027-06-09','端午节'],['2027-09-15','中秋节'],['2027-10-01','国庆节']],
  2028:[['2028-01-26','春节'],['2028-04-04','清明节'],['2028-05-01','劳动节'],['2028-05-28','端午节'],['2028-10-01','国庆节'],['2028-10-03','中秋节']],
  2029:[['2029-02-13','春节'],['2029-04-04','清明节'],['2029-05-01','劳动节'],['2029-06-16','端午节'],['2029-09-22','中秋节'],['2029-10-01','国庆节']],
  2030:[['2030-02-03','春节'],['2030-04-05','清明节'],['2030-05-01','劳动节'],['2030-06-05','端午节'],['2030-09-12','中秋节'],['2030-10-01','国庆节']]
};
export function holidaysForYear(year,region='US',locale='en'){
  const zh=locale==='zh',rows=region==='CN'?[[`${year}-01-01`,'元旦'],...(cn[year]||[])]:[
    [`${year}-01-01`,zh?'元旦':'New Year’s Day'],[nth(year,0,1,3),zh?'马丁·路德·金纪念日':'Martin Luther King Jr. Day'],[nth(year,1,1,3),zh?'总统日':'Presidents’ Day'],[last(year,4,1),zh?'阵亡将士纪念日':'Memorial Day'],[`${year}-06-19`,zh?'六月节':'Juneteenth'],[`${year}-07-04`,zh?'独立日':'Independence Day'],[nth(year,8,1,1),zh?'劳动节':'Labor Day'],[nth(year,10,4,4),zh?'感恩节':'Thanksgiving'],[`${year}-12-25`,zh?'圣诞节':'Christmas Day']
  ];
  return rows.map(([date,title])=>({id:`holiday:${date}:${title}`,title,calendarId:'holidays',start:`${date}T00:00`,end:`${date}T23:59`,allDay:true,location:'',notes:'',url:'',attendees:'',repeat:'none',alert:'none',readOnly:true}));
}
