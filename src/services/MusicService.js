// Music lives on the v86 9p volume so browser playback can stream bytes
// directly instead of transporting multi-megabyte audio through the serial TTY.
const LIBRARY='/mnt/aeris/Music';
const AUDIO=/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus)$/i;
const mimeFor=path=>({mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',wav:'audio/wav',ogg:'audio/ogg',oga:'audio/ogg',flac:'audio/flac',opus:'audio/ogg'}[path.split('.').at(-1)?.toLowerCase()]||'audio/mpeg');
const metadata=(name,path,category,size=0)=>{const stem=name.replace(/\.[^.]+$/,''),parts=stem.split(/\s+-\s+/);return{id:path,path,name,title:parts.length>1?parts.slice(1).join(' - '):stem,artist:parts.length>1?parts[0]:'Unknown Artist',category,size}};

export class MusicService{
  constructor(system){this.system=system;this.audio=new Audio();this.audio.preload='metadata';this.tracks=[];this.categories=[];this.current=null;this.libraryLoading=false;this.trackLoading=false;this.error='';this.objectUrl='';this.mode='all';this.shuffle=false;this.repeat='off';this.volume=Number(localStorage.getItem('aeris.music.volume')||.72);this.audio.volume=this.volume}
  start(){
    this.audio.addEventListener('play',()=>this.#emit());this.audio.addEventListener('pause',()=>this.#emit());this.audio.addEventListener('timeupdate',()=>this.#emit('music:time'));this.audio.addEventListener('durationchange',()=>this.#emit());
    this.audio.addEventListener('ended',()=>{if(this.repeat==='one'){this.audio.currentTime=0;this.audio.play().catch(()=>{})}else this.next()});
    this.audio.addEventListener('error',()=>{this.error='This audio file could not be decoded.';this.#emit()});
    this.kernel.bus.on('guest:ready',()=>this.refresh());this.kernel.bus.on('filesystem:changed',detail=>{if(detail?.path===LIBRARY||detail?.path?.startsWith(`${LIBRARY}/`))this.refresh()});
    if(this.system.ready)this.refresh();
  }
  stop(){this.audio.pause();this.#release()}
  snapshot(){return{library:LIBRARY,tracks:this.tracks.map(item=>({...item})),categories:[...this.categories],current:this.current?{...this.current}:null,playing:!this.audio.paused,loading:this.libraryLoading||this.trackLoading,error:this.error,currentTime:Number(this.audio.currentTime)||0,duration:Number(this.audio.duration)||0,volume:this.volume,shuffle:this.shuffle,repeat:this.repeat}}
  async refresh(){if(this.refreshTask){this.refreshQueued=true;return this.refreshTask}this.libraryLoading=true;this.error='';this.#emit();this.refreshTask=(async()=>{try{do{this.refreshQueued=false;await this.system.mkdir(LIBRARY);const root=await this.system.list(LIBRARY,{fresh:true,priority:true,timeout:20000}),folders=root.filter(item=>item.type==='directory'),tracks=root.filter(item=>item.type!=='directory'&&AUDIO.test(item.name)).map(item=>metadata(item.name,`${LIBRARY}/${item.name}`,'Library',item.size));for(const folder of folders){const path=`${LIBRARY}/${folder.name}`;try{const items=await this.system.list(path,{fresh:true,priority:true,timeout:20000});tracks.push(...items.filter(item=>item.type!=='directory'&&AUDIO.test(item.name)).map(item=>metadata(item.name,`${path}/${item.name}`,folder.name,item.size)))}catch{}}this.tracks=tracks;this.categories=[...new Set(tracks.filter(item=>item.category!=='Library').map(item=>item.category))];if(this.current)this.current=this.tracks.find(item=>item.path===this.current.path)||null}while(this.refreshQueued)}catch(error){this.error=error.message}finally{this.libraryLoading=false;this.refreshTask=null;this.#emit()}})();return this.refreshTask}
  async play(trackOrId){const track=typeof trackOrId==='string'?this.tracks.find(item=>item.id===trackOrId||item.path===trackOrId||item.title.toLowerCase().includes(trackOrId.toLowerCase())):trackOrId;if(!track)throw new Error('Music track not found.');if(this.current?.path!==track.path){this.audio.pause();this.#release();this.current=track;this.error='';this.trackLoading=true;this.#emit();try{const bytes=await this.system.readBytes(track.path,{priority:true,timeout:180000});this.objectUrl=URL.createObjectURL(new Blob([bytes],{type:mimeFor(track.path)}));this.audio.src=this.objectUrl;this.audio.load()}finally{this.trackLoading=false;this.#emit()}}await this.audio.play();return{...track}}
  pause(){this.audio.pause()}
  toggle(){return this.audio.paused?(this.current?this.audio.play():this.tracks[0]?this.play(this.tracks[0]):Promise.resolve()):this.pause()}
  next(){if(!this.tracks.length)return;let index=this.tracks.findIndex(item=>item.path===this.current?.path);if(this.shuffle)index=Math.floor(Math.random()*this.tracks.length);else index=(index+1)%this.tracks.length;return this.play(this.tracks[index]).catch(()=>{})}
  previous(){if(this.audio.currentTime>4){this.audio.currentTime=0;return}if(!this.tracks.length)return;const index=this.tracks.findIndex(item=>item.path===this.current?.path);return this.play(this.tracks[(index<=0?this.tracks.length:index)-1]).catch(()=>{})}
  seek(seconds){this.audio.currentTime=Math.max(0,Math.min(Number(this.audio.duration)||0,Number(seconds)||0));this.#emit()}
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));this.audio.volume=this.volume;localStorage.setItem('aeris.music.volume',String(this.volume));this.#emit('music:volume')}
  toggleShuffle(){this.shuffle=!this.shuffle;this.#emit()}
  cycleRepeat(){this.repeat=this.repeat==='off'?'all':this.repeat==='all'?'one':'off';this.#emit()}
  #release(){if(this.objectUrl)URL.revokeObjectURL(this.objectUrl);this.objectUrl=''}
  #emit(event='music:changed'){this.kernel?.bus.emit(event,this.snapshot())}
}

export {LIBRARY as MUSIC_LIBRARY};
