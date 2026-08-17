const builtin=(id,glyph,sizes=['medium'],defaultSize=sizes[0])=>({
  id,glyph,sizes,defaultSize,system:true,
  name:{en:id==='date'?'Date':id==='agenda'?'Up Next':id==='system'?'System Status':id==='weather'?'Weather':'Favorites',zh:id==='date'?'日期':id==='agenda'?'接下来':id==='system'?'系统状态':id==='weather'?'天气':'收藏'},
  description:{en:id==='date'?'The current date and time.':id==='agenda'?'Upcoming events and reminders.':id==='system'?'Live machine and memory status.':id==='weather'?'Current local weather.':'Quick access to favorite apps.',zh:id==='date'?'当前日期与时间。':id==='agenda'?'即将开始的日程与提醒。':id==='system'?'实时机器与内存状态。':id==='weather'?'当前位置的天气。':'快速打开常用应用。'},
});

export const builtinWidgets=[
  builtin('date','calendar',['medium']),
  builtin('agenda','reminder',['large']),
  builtin('system','memory',['large']),
  builtin('weather','sun',['medium']),
  builtin('launcher','grid',['small']),
];
