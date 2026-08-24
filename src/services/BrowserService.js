const STORAGE_KEY='aeris.browser.v1';
const HOME_URL='about:blank';
const clone=value=>structuredClone(value);
const titleFor=url=>{try{return new URL(url).hostname.replace(/^www\./,'')||'New Tab'}catch{return'New Tab'}};
const normaliseUrl=value=>{
  const input=String(value||'').trim();if(!input)return HOME_URL;
  if(input===HOME_URL)return input;
  const candidate=/^[a-z][a-z\d+.-]*:/i.test(input)?input:/^[^\s]+\.[^\s]+/.test(input)?`https://${input}`:`https://www.google.com/search?q=${encodeURIComponent(input)}`;
  const url=new URL(candidate);if(!['http:','https:'].includes(url.protocol))throw new Error('Aeris Browser supports HTTP and HTTPS pages.');if(globalThis.location?.origin&&url.origin===globalThis.location.origin)throw new Error('Aeris Browser cannot embed the Aeris system origin.');return url.toString();
};
const newTab=url=>{url=normaliseUrl(url);return{id:crypto.randomUUID(),url,title:titleFor(url),entries:[url],entryIndex:0,reloadKey:0,createdAt:Date.now(),updatedAt:Date.now()}};

export class BrowserService{
  constructor({storage=globalThis.localStorage}={}){this.storage=storage;this.state={tabs:[],activeTabId:'',history:[],bookmarks:[]}}
  start(){try{this.state=this.#normalise(JSON.parse(this.storage?.getItem(STORAGE_KEY)||'{}'))}catch{this.state=this.#normalise({})}this.#persist()}
  snapshot(){return clone(this.state)}
  active(){return clone(this.state.tabs.find(tab=>tab.id===this.state.activeTabId)||null)}
  newTab(url=HOME_URL){const tab=newTab(url);this.state.tabs.push(tab);this.state.activeTabId=tab.id;this.#visit(tab);this.#changed('new-tab',tab);return clone(tab)}
  select(id){if(!this.state.tabs.some(tab=>tab.id===id))throw new Error('Browser tab not found.');this.state.activeTabId=id;this.#changed('select',this.active());return this.active()}
  close(id){const index=this.state.tabs.findIndex(tab=>tab.id===id);if(index<0)return false;this.state.tabs.splice(index,1);if(!this.state.tabs.length)this.state.tabs.push(newTab(HOME_URL));if(this.state.activeTabId===id)this.state.activeTabId=this.state.tabs[Math.min(index,this.state.tabs.length-1)].id;this.#changed('close',this.active());return true}
  resetSession(){const tab=newTab(HOME_URL);this.state.tabs=[tab];this.state.activeTabId=tab.id;this.#changed('reset-session',tab);return clone(tab)}
  clearData(){const tab=newTab(HOME_URL);this.state={tabs:[tab],activeTabId:tab.id,history:[],bookmarks:[]};this.storage?.removeItem(STORAGE_KEY);this.kernel?.bus.emit('browser:changed',{type:'clear-data',tab:clone(tab),state:this.snapshot()})}
  navigate(value,{tabId=this.state.activeTabId,replace=false}={}){const tab=this.#tab(tabId),url=normaliseUrl(value);if(replace)tab.entries[tab.entryIndex]=url;else{tab.entries=tab.entries.slice(0,tab.entryIndex+1);tab.entries.push(url);tab.entryIndex=tab.entries.length-1}tab.url=url;tab.title=titleFor(url);tab.updatedAt=Date.now();this.state.activeTabId=tab.id;this.#visit(tab);this.#changed('navigate',tab);return clone(tab)}
  back(id=this.state.activeTabId){const tab=this.#tab(id);if(tab.entryIndex>0){tab.entryIndex--;this.#syncEntry(tab);this.#changed('navigate',tab)}return clone(tab)}
  forward(id=this.state.activeTabId){const tab=this.#tab(id);if(tab.entryIndex<tab.entries.length-1){tab.entryIndex++;this.#syncEntry(tab);this.#changed('navigate',tab)}return clone(tab)}
  reload(id=this.state.activeTabId){const tab=this.#tab(id);tab.reloadKey++;tab.updatedAt=Date.now();this.#changed('reload',tab);return clone(tab)}
  updateTitle(id,title){const tab=this.#tab(id),next=String(title||'').trim().slice(0,180);if(!next||next===tab.title)return clone(tab);tab.title=next;tab.updatedAt=Date.now();this.#changed('title',tab);return clone(tab)}
  toggleBookmark(id=this.state.activeTabId){const tab=this.#tab(id),index=this.state.bookmarks.findIndex(item=>item.url===tab.url);if(index>=0)this.state.bookmarks.splice(index,1);else if(tab.url!==HOME_URL)this.state.bookmarks.unshift({id:crypto.randomUUID(),url:tab.url,title:tab.title,createdAt:Date.now()});this.#changed('bookmarks',tab);return index<0}
  isBookmarked(url=this.active()?.url){return this.state.bookmarks.some(item=>item.url===url)}
  removeBookmark(id){this.state.bookmarks=this.state.bookmarks.filter(item=>item.id!==id);this.#changed('bookmarks',this.active())}
  clearHistory(){this.state.history=[];this.#changed('history',this.active())}
  #tab(id){const tab=this.state.tabs.find(item=>item.id===id);if(!tab)throw new Error('Browser tab not found.');return tab}
  #syncEntry(tab){tab.url=tab.entries[tab.entryIndex];tab.title=titleFor(tab.url);tab.updatedAt=Date.now();this.#visit(tab)}
  #visit(tab){if(tab.url===HOME_URL)return;this.state.history=this.state.history.filter(item=>item.url!==tab.url);this.state.history.unshift({id:crypto.randomUUID(),url:tab.url,title:tab.title,visitedAt:Date.now()});this.state.history=this.state.history.slice(0,300)}
  #normalise(value){const tabs=(Array.isArray(value?.tabs)?value.tabs:[]).map(item=>{try{const entries=(Array.isArray(item.entries)?item.entries:[item.url]).map(normaliseUrl),entryIndex=Math.max(0,Math.min(entries.length-1,Number(item.entryIndex)||0)),url=entries[entryIndex];return{...newTab(url),...item,url,title:String(item.title||titleFor(url)),entries,entryIndex,reloadKey:Number(item.reloadKey)||0}}catch{return null}}).filter(Boolean);if(!tabs.length)tabs.push(newTab(HOME_URL));const activeTabId=tabs.some(tab=>tab.id===value?.activeTabId)?value.activeTabId:tabs[0].id,clean=item=>{try{const url=normaliseUrl(item.url);return{...item,url,title:String(item.title||titleFor(url)).slice(0,180)}}catch{return null}};return{tabs,activeTabId,history:(Array.isArray(value?.history)?value.history:[]).map(clean).filter(Boolean).slice(0,300),bookmarks:(Array.isArray(value?.bookmarks)?value.bookmarks:[]).map(clean).filter(Boolean).slice(0,100)}}
  #changed(type,tab){this.#persist();this.kernel?.bus.emit('browser:changed',{type,tab:tab?clone(tab):null,state:this.snapshot()})}
  #persist(){this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.state))}
}

export const BROWSER_STORAGE_KEY=STORAGE_KEY;
