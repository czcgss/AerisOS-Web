const enc=value=>encodeURIComponent(String(value));
const dec=value=>decodeURIComponent(String(value));
const text=value=>String(value??'');
const matches=(value,query)=>!query||text(value).toLowerCase().includes(text(query).toLowerCase());
const fileUri=path=>`future://files${String(path).startsWith('/')?path:`/${path}`}`;

const contactEntity=contact=>({
  uri:`future://contacts/${enc(contact.id)}`,type:'contact',appId:'contacts',id:String(contact.id),title:contact.name||'Unnamed contact',subtitle:contact.email||contact.phone||'',
  properties:{name:contact.name||'',email:contact.email||'',phone:contact.phone||'',favorite:!!contact.favorite},relationships:[],actions:[],
});

export const createContactsEntityProvider=userdata=>({
  type:'contact',appId:'contacts',label:'Contacts',owns:uri=>/^future:\/\/contacts\/[^/]+$/.test(uri),
  async search({query,limit}){return(await userdata.load('contacts',[])).filter(item=>matches(`${item.name} ${item.email} ${item.phone}`,query)).slice(0,limit).map(contactEntity)},
  async get(uri){const id=dec(uri.split('/').at(-1)),contact=(await userdata.load('contacts',[])).find(item=>String(item.id)===id);return contact?contactEntity(contact):null},
});

const trackEntity=(track,music)=>{
  const current=music.snapshot(),isCurrent=current.current?.id===track.id;
  return{uri:`future://music/tracks/${enc(track.id)}`,type:'music.track',appId:'music',id:String(track.id),title:track.title||track.name,subtitle:[track.artist,track.category].filter(Boolean).join(' · '),properties:{path:track.path,artist:track.artist,category:track.category,size:Number(track.size)||0,isCurrent,playing:isCurrent&&current.playing,currentTime:isCurrent?current.currentTime:0,duration:isCurrent?current.duration:0},relationships:[{predicate:'storedAs',target:fileUri(track.path)}],actions:[{id:'music.track.play',label:'Play track',tool:'future_music',operation:'play',risk:'safe',mutates:true,parameters:{song:track.path}}]};
};
export const createMusicEntityProvider=music=>({
  type:'music.track',appId:'music',label:'Music tracks',owns:uri=>/^future:\/\/music\/tracks\/[^/]+$/.test(uri),
  async search({query,filters,limit}){const tracks=music.snapshot().tracks;return tracks.filter(track=>(!filters.category||track.category===filters.category)&&matches(`${track.title} ${track.artist} ${track.category}`,query)).slice(0,limit).map(track=>trackEntity(track,music))},
  async get(uri){const id=dec(uri.split('/').at(-1)),track=music.snapshot().tracks.find(item=>String(item.id)===id);return track?trackEntity(track,music):null},
});

const browserTabEntity=tab=>({
  uri:`future://browser/tabs/${enc(tab.id)}`,type:'browser.tab',appId:'browser',id:String(tab.id),title:tab.title||'New Tab',subtitle:tab.url||'',updatedAt:Number(tab.updatedAt)||0,
  properties:{url:tab.url,title:tab.title||'',historyIndex:Number(tab.entryIndex)||0,historyLength:tab.entries?.length||0},relationships:[],
  actions:[{id:'browser.tab.navigate',label:'Navigate tab',tool:'future_browser',operation:'navigate',risk:'safe',mutates:true,parameters:{url:tab.url}}],
});
export const createBrowserEntityProvider=browser=>({
  type:'browser.tab',appId:'browser',label:'Browser tabs',owns:uri=>/^future:\/\/browser\/tabs\/[^/]+$/.test(uri),
  async search({query,limit}){return browser.snapshot().tabs.filter(tab=>matches(`${tab.title} ${tab.url}`,query)).slice(0,limit).map(browserTabEntity)},
  async get(uri){const id=dec(uri.split('/').at(-1)),tab=browser.snapshot().tabs.find(item=>String(item.id)===id);return tab?browserTabEntity(tab):null},
});

const photoEntity=(entry,state={})=>{
  const path=`/home/future/Pictures/${entry.name}`;
  return{uri:`future://photos/${enc(entry.name)}`,type:'photo',appId:'photos',id:entry.name,title:entry.name,subtitle:path,properties:{path,size:Number(entry.size)||0,modified:Number(entry.modified)||0,favorite:(state.favorites||[]).includes(entry.name),albums:(state.albums||[]).filter(album=>album.items?.includes(entry.name)).map(album=>album.name)},updatedAt:Number(entry.modified)||0,relationships:[{predicate:'storedAs',target:fileUri(path)}],actions:[]};
};
export const createPhotosEntityProvider=(system,userdata)=>({
  type:'photo',appId:'photos',label:'Photos',owns:uri=>/^future:\/\/photos\/[^/]+$/.test(uri),
  async search({query,filters,limit}){let items=[];try{items=await system.list('/home/future/Pictures',{instant:true,timeout:8000})}catch{}const state=await userdata.load('photos',{favorites:[],albums:[]});return items.filter(item=>item.type!=='directory'&&/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(item.name)&&(!filters.favorite||state.favorites?.includes(item.name))&&matches(item.name,query)).slice(0,limit).map(item=>photoEntity(item,state))},
  async get(uri){const name=dec(uri.split('/').at(-1));let items=[];try{items=await system.list('/home/future/Pictures',{instant:false,timeout:12000})}catch{return null}const item=items.find(entry=>entry.name===name);if(!item)return null;return photoEntity(item,await userdata.load('photos',{favorites:[],albums:[]}))},
});

const weatherEntity=snapshot=>{const location=snapshot.location||{},id=`${location.latitude},${location.longitude}`,current=snapshot.data?.current||{};return{uri:`future://weather/locations/${enc(id)}`,type:'weather.location',appId:'weather',id,title:location.name||'Weather location',subtitle:[location.admin1,location.country].filter(Boolean).join(', '),properties:{...location,current:{temperature:current.temperature_2m,apparentTemperature:current.apparent_temperature,humidity:current.relative_humidity_2m,weatherCode:current.weather_code,windSpeed:current.wind_speed_10m},fetchedAt:snapshot.data?.fetchedAt||0},updatedAt:Number(snapshot.data?.fetchedAt)||0,relationships:[],actions:[{id:'weather.location.read',label:'Read current weather',tool:'future_weather',operation:'current',risk:'safe',mutates:false,parameters:{location:location.name}}]};};
export const createWeatherEntityProvider=weather=>({
  type:'weather.location',appId:'weather',label:'Weather locations',owns:uri=>/^future:\/\/weather\/locations\/[^/]+$/.test(uri),
  async search({query,limit}){const snapshot=weather.snapshot();return matches(`${snapshot.location.name} ${snapshot.location.admin1} ${snapshot.location.country}`,query)?[weatherEntity(snapshot)].slice(0,limit):[]},
  async get(uri){const entity=weatherEntity(weather.snapshot());return entity.uri===uri?entity:null},
});
