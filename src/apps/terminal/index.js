import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const theme={
  background:'#0f181f',foreground:'#d9e2e8',cursor:'#67c58b',cursorAccent:'#0f181f',selectionBackground:'#356b7eaa',
  black:'#111a22',red:'#ef7373',green:'#67c58b',yellow:'#e9bc64',blue:'#5aa7e8',magenta:'#b398ed',cyan:'#55c2c8',white:'#d9e2e8',
  brightBlack:'#607582',brightRed:'#ff8a8a',brightGreen:'#7cdda0',brightYellow:'#f4cb75',brightBlue:'#72b8f2',brightMagenta:'#c7adff',brightCyan:'#6dd8de',brightWhite:'#f5f8fa'
};

export default{
  id:'terminal',title:'terminal',icon:'terminal',color:'slate',width:920,height:610,singleInstance:true,
  mount(root,{kernel,system,i18n,clipboard,shell}){
    let nextId=1,activeId=null,fitFrame=0,resizeTimer=0,sessions=[];
    root.innerHTML=`<div class="system-app terminal-pro terminal-native" data-terminal-theme="agnoster"><header><div class="terminal-tabs" data-terminal-tabs></div><div class="terminal-session-meta"><i data-terminal-state-dot></i><span data-terminal-state></span></div></header><main class="terminal-native-host" data-terminal-host></main><footer><span class="terminal-connection"><i></i><b data-terminal-connection></b></span><span>UTF-8</span><span>ash</span></footer><menu class="terminal-context-menu" data-terminal-menu hidden><button data-terminal-copy>${i18n.t('copy')}</button><button data-terminal-paste>${i18n.t('paste')}</button></menu></div>`;
    const host=root.querySelector('[data-terminal-host]'),tabs=root.querySelector('[data-terminal-tabs]'),menu=root.querySelector('[data-terminal-menu]');
    const dispose=resource=>typeof resource==='function'?resource():resource?.dispose?.();
    const active=()=>sessions.find(session=>session.id===activeId);
    const setStatus=()=>{
      const ready=system.ready,state=root.querySelector('[data-terminal-state]'),dot=root.querySelector('[data-terminal-state-dot]'),connection=root.querySelector('[data-terminal-connection]');
      state.textContent=i18n.t(ready?'terminalReady':'terminalWaiting');
      connection.textContent=ready?'aeris@aeris':'Linux offline';
      dot.classList.toggle('offline',!ready);
      root.querySelector('.terminal-connection i').classList.toggle('offline',!ready)
    };
    const drawTabs=()=>{
      tabs.innerHTML=`${sessions.map((session,index)=>`<button data-terminal-tab="${session.id}" class="${session.id===activeId?'selected':''}"><i></i><span>${i18n.t('terminal')}${sessions.length>1?` ${index+1}`:''}</span>${sessions.length>1?`<b data-terminal-close="${session.id}">×</b>`:''}</button>`).join('')}<button data-terminal-new aria-label="${i18n.t('newTab')}">+</button>`;
      tabs.querySelectorAll('[data-terminal-tab]').forEach(button=>button.onclick=event=>{if(event.target.closest('[data-terminal-close]'))return;show(Number(button.dataset.terminalTab))});
      tabs.querySelectorAll('[data-terminal-close]').forEach(button=>button.onclick=event=>{event.stopPropagation();closeSession(Number(button.dataset.terminalClose))});
      tabs.querySelector('[data-terminal-new]').onclick=createSession
    };
    const resize=()=>{
      cancelAnimationFrame(fitFrame);
      fitFrame=requestAnimationFrame(()=>{
        const session=active();
        if(!session||session.pane.hidden)return;
        try{session.fit.fit()}catch{return}
        clearTimeout(resizeTimer);
        resizeTimer=setTimeout(()=>system.resizeTerminal(session.port,session.terminal.cols,session.terminal.rows),180)
      })
    };
    const show=id=>{
      activeId=id;
      sessions.forEach(session=>session.pane.hidden=session.id!==id);
      drawTabs();
      const session=active();
      resize();
      setTimeout(()=>session?.terminal.focus())
    };
    const copy=async()=>{const text=active()?.terminal.getSelection()||'';if(text&&await clipboard.copyText(text))shell.toast(i18n.t('copiedToClipboard'));menu.hidden=true};
    const paste=()=>{const text=clipboard.value||'';if(text)system.writeTerminal(text,active()?.port);menu.hidden=true;active()?.terminal.focus()};
    const shortcut=(session,event)=>{
      const key=event.key.toLowerCase(),copyKey=(event.metaKey||event.ctrlKey&&event.shiftKey)&&key==='c',pasteKey=(event.metaKey||event.ctrlKey&&event.shiftKey)&&key==='v';
      if(event.ctrlKey&&!event.metaKey&&!event.shiftKey&&key==='c'){
        if(event.type==='keydown')system.writeTerminal('\u0003',session.port);
        return false
      }
      if(copyKey&&session.terminal.hasSelection()){if(event.type==='keydown')copy();return false}
      if(pasteKey){if(event.type==='keydown')paste();return false}
      return true
    };
    function createSession(){
      const used=new Set(sessions.map(session=>session.port)),port=system.terminalPorts().find(candidate=>!used.has(candidate));
      if(!port){shell.toast(i18n.t('terminalSessionLimit'));return}
      const id=nextId++,pane=document.createElement('section');
      pane.className='terminal-native-pane';pane.dataset.terminalPane=id;host.appendChild(pane);
      const terminal=new Terminal({allowTransparency:true,convertEol:false,cursorBlink:true,cursorStyle:'bar',fontFamily:'"Ubuntu Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',fontSize:14,fontWeight:'400',fontWeightBold:'700',letterSpacing:0,lineHeight:1.08,scrollback:10000,smoothScrollDuration:0,theme});
      const fit=new FitAddon();terminal.loadAddon(fit);terminal.open(pane);
      const session={id,port,pane,terminal,fit,disposables:[]};sessions.push(session);
      session.disposables.push(terminal.onData(data=>system.writeTerminal(data,port)));
      session.disposables.push(terminal.onTitleChange(title=>{session.title=title;drawTabs()}));
      session.disposables.push(kernel.bus.on('terminal:data',detail=>{if(detail.port===port)terminal.write(detail.data)}));
      terminal.attachCustomKeyEventHandler(event=>shortcut(session,event));
      pane.oncontextmenu=event=>{event.preventDefault();show(id);const bounds=root.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(event.clientX-bounds.left,bounds.width-130))}px`;menu.style.top=`${Math.max(48,Math.min(event.clientY-bounds.top,bounds.height-82))}px`;menu.querySelector('[data-terminal-copy]').disabled=!terminal.hasSelection();menu.querySelector('[data-terminal-paste]').disabled=!clipboard.value;menu.hidden=false};
      const replay=system.terminalReplay(port);if(replay)terminal.write(replay);
      show(id);
      if(system.ready)setTimeout(()=>{resize();system.writeTerminal('\r',port)},80)
    }
    function closeSession(id){
      const session=sessions.find(item=>item.id===id);if(!session)return;
      session.disposables.forEach(dispose);
      session.terminal.dispose();session.pane.remove();system.resetTerminal(session.port);
      sessions=sessions.filter(item=>item.id!==id);
      if(!sessions.length)return createSession();
      show(sessions.at(-1).id)
    }
    menu.querySelector('[data-terminal-copy]').onclick=copy;
    menu.querySelector('[data-terminal-paste]').onclick=paste;
    root.addEventListener('pointerdown',event=>{if(!event.target.closest('[data-terminal-menu]'))menu.hidden=true});
    const observer=new ResizeObserver(resize);observer.observe(host);
    const offDataReady=kernel.bus.on('guest:ready',()=>{setStatus();sessions.forEach(session=>{session.terminal.reset();const replay=system.terminalReplay(session.port);if(replay)session.terminal.write(replay);system.writeTerminal('\r',session.port)});resize()});
    const offStatus=kernel.bus.on('machine:status',setStatus);
    createSession();setStatus();
    return()=>{cancelAnimationFrame(fitFrame);clearTimeout(resizeTimer);observer.disconnect();offDataReady();offStatus();const resets=sessions.map(session=>{session.disposables.forEach(dispose);session.terminal.dispose();return system.resetTerminal(session.port)});sessions=[];return Promise.allSettled(resets)}
  }
};
