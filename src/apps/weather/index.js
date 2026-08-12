import {icon} from '../../icons.js';
import {weatherDetailMarkup,weatherEsc as esc,weatherNumber as n,weatherViewData} from './view.js';

export default{
  id:'weather',title:'weather',icon:'sun',color:'cyan',width:1050,height:690,singleInstance:true,
  mount(root,{weather,i18n,kernel}){
    let searchOpen=false,searchQuery='',results=[],searchTimer=0,searchSequence=0,searching=false,composing=false;
    const locale=()=>i18n.t('dateFormat'),state=()=>weather.snapshot();
    const resultsMarkup=()=>searching?`<div class="weather-searching"><i></i>${i18n.t('searching')}</div>`:results.map((place,index)=>`<button data-weather-place="${index}"><span><strong>${esc(place.name)}</strong><small>${esc([place.admin1,place.country].filter(Boolean).join(', '))}</small></span><b>${esc(place.country_code||'')}</b></button>`).join('');
    const searchMarkup=()=>`<section class="weather-search"><div><label>${icon('search',16)}<input value="${esc(searchQuery)}" placeholder="${i18n.t('searchCity')}" autocomplete="off" spellcheck="false"><button data-weather-close>×</button></label><div data-weather-results>${resultsMarkup()}</div></div></section>`;
    const draw=()=>{
      const s=state(),{data,current,condition}=weatherViewData(s,i18n);
      root.innerHTML=`<div class="system-app weather-app weather-${condition.key}"><aside><header>${icon('sun',22)}<strong>${i18n.t('weather')}</strong><button data-weather-search>${icon('search',15)}</button></header><button class="weather-place selected"><span><strong>${esc(s.location.name)}</strong><small>${esc(s.location.admin1||s.location.country)}</small></span><b>${current?`${n(current.temperature_2m)}°`:'—'}</b></button><footer>${s.error?`<span class="weather-error">${esc(s.error)}</span>`:`<span>${i18n.t('weatherUpdated')} ${data?new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit'}).format(data.fetchedAt):'—'}</span>`}</footer></aside><main>${weatherDetailMarkup(s,i18n)}</main>${searchOpen?searchMarkup():''}</div>`;
      bind();
    };
    const bindPlaces=()=>root.querySelectorAll('[data-weather-place]').forEach(button=>button.onclick=()=>{const place=results[Number(button.dataset.weatherPlace)];if(!place)return;searchOpen=false;weather.select(place).catch(()=>{});draw()});
    const updateResults=()=>{const container=root.querySelector('[data-weather-results]');if(!container)return;container.innerHTML=resultsMarkup();bindPlaces()};
    const runSearch=()=>{clearTimeout(searchTimer);const query=searchQuery.trim(),sequence=++searchSequence;if(query.length<2){results=[];searching=false;updateResults();return}searchTimer=setTimeout(async()=>{searching=true;updateResults();try{const next=await weather.search(query);if(sequence!==searchSequence)return;results=next}catch{if(sequence!==searchSequence)return;results=[]}finally{if(sequence===searchSequence){searching=false;updateResults()}}},280)};
    const openSearch=()=>{searchOpen=true;searchQuery='';results=[];searching=false;draw();requestAnimationFrame(()=>root.querySelector('.weather-search input')?.focus())};
    const closeSearch=()=>{clearTimeout(searchTimer);searchSequence++;searchOpen=false;draw()};
    const bind=()=>{
      root.querySelectorAll('[data-weather-search]').forEach(button=>button.onclick=openSearch);
      root.querySelector('[data-weather-close]')?.addEventListener('click',closeSearch);
      root.querySelector('[data-weather-refresh]')?.addEventListener('click',()=>weather.refresh(true).catch(()=>{}));
      const input=root.querySelector('.weather-search input');
      if(input){input.oncompositionstart=()=>{composing=true};input.oncompositionend=()=>{composing=false;searchQuery=input.value;runSearch()};input.oninput=()=>{searchQuery=input.value;if(!composing)runSearch()}}
      bindPlaces();
    };
    const off=kernel.bus.on('weather:update',()=>{if(!searchOpen)draw()});draw();weather.refresh().catch(()=>{});return()=>{clearTimeout(searchTimer);off()};
  }
};
