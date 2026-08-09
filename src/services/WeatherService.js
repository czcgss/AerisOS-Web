const CACHE_KEY='aeris.weather.cache';
const LOCATION_KEY='aeris.weather.location';
const DEFAULT_LOCATION={name:'New York',admin1:'New York',country:'United States',latitude:40.7128,longitude:-74.006,timezone:'America/New_York'};

export class WeatherService{
  constructor(settings,storage=localStorage){this.settings=settings;this.storage=storage;this.location=this.#read(LOCATION_KEY,DEFAULT_LOCATION);this.data=this.#read(CACHE_KEY,null);this.loading=false;this.error=''}
  start(){if(!this.data||Date.now()-(this.data.fetchedAt||0)>30*60*1000)this.refresh().catch(()=>{});}
  #read(key,fallback){try{return JSON.parse(this.storage.getItem(key))||fallback}catch{return fallback}}
  snapshot(){return{location:{...this.location},data:this.data?structuredClone(this.data):null,loading:this.loading,error:this.error}}
  async search(query,{signal,language}={}){
    language=language||(this.settings.get('locale')==='zh'?'zh':'en');
    const response=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=${language}&format=json`,{signal});
    if(!response.ok)throw new Error(`Location search failed (${response.status})`);
    return (await response.json()).results||[];
  }
  async select(location){
    this.location={name:location.name,admin1:location.admin1||'',country:location.country||'',latitude:location.latitude,longitude:location.longitude,timezone:location.timezone||'auto'};
    this.storage.setItem(LOCATION_KEY,JSON.stringify(this.location));
    return this.refresh(true);
  }
  async lookup(query,signal,timeout=15000){
    const request=this.#request(signal,timeout);
    try{
      const match=(await this.search(query,{signal:request.signal,language:'en'}))[0];
      if(!match)throw new Error(`No weather location matched “${query}”.`);
      const location={name:match.name,admin1:match.admin1||'',country:match.country||'',latitude:match.latitude,longitude:match.longitude,timezone:match.timezone||'auto'};
      return{location,data:await this.#forecast(location,request.signal)};
    }catch(error){if(request.timedOut())throw new Error(`Weather lookup timed out after ${Math.round(timeout/1000)} seconds.`);throw error}
    finally{request.close()}
  }
  async refresh(force=false,{signal,timeout=0}={}){
    if(this.loading)return this.data;
    if(!force&&this.data&&Date.now()-(this.data.fetchedAt||0)<10*60*1000)return this.data;
    this.loading=true;this.error='';this.#emit();
    const request=this.#request(signal,timeout);
    try{
      this.data=await this.#forecast(this.location,request.signal);this.storage.setItem(CACHE_KEY,JSON.stringify(this.data));return this.data;
    }catch(error){this.error=request.timedOut()?'Weather lookup timed out after 15 seconds.':error.message;throw request.timedOut()?new Error(this.error):error}finally{request.close();this.loading=false;this.#emit()}
  }
  async #forecast(location,signal){
    const params=new URLSearchParams({latitude:location.latitude,longitude:location.longitude,timezone:'auto',forecast_days:'10',current:'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,precipitation',hourly:'temperature_2m,weather_code,precipitation_probability',daily:'weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset,precipitation_probability_max'});
    const response=await fetch(`https://api.open-meteo.com/v1/forecast?${params}`,{signal});
    if(!response.ok)throw new Error(`Weather service failed (${response.status})`);
    return{...(await response.json()),fetchedAt:Date.now()};
  }
  #request(parent,timeout){
    const controller=new AbortController();let timeoutId=0,didTimeout=false;
    const abort=()=>controller.abort(parent?.reason);
    if(parent?.aborted)abort();else parent?.addEventListener('abort',abort,{once:true});
    if(timeout)timeoutId=setTimeout(()=>{didTimeout=true;controller.abort()},timeout);
    return{signal:controller.signal,timedOut:()=>didTimeout,close:()=>{clearTimeout(timeoutId);parent?.removeEventListener('abort',abort)}};
  }
  #emit(){this.kernel?.bus.emit('weather:update',this.snapshot())}
}

export function weatherCondition(code,locale='en'){
  const zh=locale==='zh';
  if(code===0)return{key:'clear',label:zh?'晴朗':'Clear',glyph:'sun'};
  if([1,2].includes(code))return{key:'partly',label:zh?'晴间多云':'Partly Cloudy',glyph:'sun'};
  if(code===3)return{key:'cloudy',label:zh?'多云':'Cloudy',glyph:'cloud'};
  if([45,48].includes(code))return{key:'fog',label:zh?'有雾':'Fog',glyph:'cloud'};
  if([51,53,55,56,57].includes(code))return{key:'drizzle',label:zh?'毛毛雨':'Drizzle',glyph:'rain'};
  if([61,63,65,66,67,80,81,82].includes(code))return{key:'rain',label:zh?'有雨':'Rain',glyph:'rain'};
  if([71,73,75,77,85,86].includes(code))return{key:'snow',label:zh?'有雪':'Snow',glyph:'snow'};
  if([95,96,99].includes(code))return{key:'storm',label:zh?'雷暴':'Thunderstorms',glyph:'storm'};
  return{key:'unknown',label:zh?'天气':'Weather',glyph:'cloud'};
}
