import {mountClockView} from './view.js';
export default{
  id:'clock',title:'clock',icon:'clock',color:'slate',width:720,height:500,singleInstance:true,
  mount(root,{i18n}){
    root.innerHTML='<div class="system-app clock-view-host"></div>';return mountClockView(root.querySelector('.clock-view-host'),i18n)
  }
};
