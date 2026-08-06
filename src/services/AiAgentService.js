import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';

export const AI_DATA_DIRECTORY = '/home/aeris/.local/share/aeris-ai';
export const AI_STATE_PATH = `${AI_DATA_DIRECTORY}/state.json`;
export const AI_PREVIOUS_STATE_PATH = `${AI_DATA_DIRECTORY}/state.previous.json`;
export const AI_RECOVERY_KEY = 'aeris.ai.recovery.v1';

const PROVIDER_ID = 'aeris-openai-compatible';
const defaultConfig = () => ({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  systemPrompt: 'You are the Aeris system assistant. Be concise, helpful, and transparent. Reply in the language used by the user.',
  disabledToolApps: [],
});
const clone = value => structuredClone(value);
const now = () => Date.now();
const repairUtf8String = value => {
  if (typeof value !== 'string' || !value || [...value].some(character => character.charCodeAt(0) > 255)) return value;
  try {
    const bytes=Uint8Array.from([...value],character=>character.charCodeAt(0)),decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    return decoded!==value&&(/[\u0080-\u00bfÃÂð]/.test(value)||/[\u3400-\u9fff\u{1f300}-\u{1faff}]/u.test(decoded))?decoded:value;
  } catch { return value; }
};
const repairUtf8Tree = value => {
  if (typeof value === 'string') return repairUtf8String(value);
  if (Array.isArray(value)) return value.map(repairUtf8Tree);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,repairUtf8Tree(item)]));
  return value;
};

export class AiAgentService {
  constructor(system, toolService = null, storage = globalThis.localStorage) {
    this.system = system;
    this.toolService = toolService;
    this.storage = storage;
    this.ready = false;
    this.loading = false;
    this.error = '';
    this.state = { version: 3, updatedAt: 0, config: defaultConfig(), sessions: [] };
    this.agents = new Map();
    this.queuedMessages = new Map();
    this.activeTurns = new Map();
    this.settlingSessions = new Set();
    this.persistChain = Promise.resolve();
    this.guestSynced = false;
    this.syncError = '';
  }

  start() {
    const cached=this.#loadRecovery();if(cached)this.state=cached;
    this.ready=true;
    queueMicrotask(()=>this.#emit('ai:ready',{source:cached?'browser-recovery':'local'}));
    this.kernel.bus.on('system:ready', () => this.load().catch(() => {}));
    if (this.system.ready) this.load().catch(() => {});
  }

  async load() {
    if (this.guestSynced || this.loading || !this.system.ready) return;
    this.loading = true;
    this.syncError = '';
    try {
      await this.system.mkdir(AI_DATA_DIRECTORY);
      const cached=this.#loadRecovery();let saved=null,readError=null,missing=false,recoveredFromPrevious=false;
      try{saved=await this.#readState(AI_STATE_PATH)}catch(error){
        readError=error;
        try{saved=await this.#readState(AI_PREVIOUS_STATE_PATH);recoveredFromPrevious=true}catch(previousError){missing=this.#isMissing(error)&&this.#isMissing(previousError)}
      }
      if(saved){
        const repaired=repairUtf8Tree(saved),guestState=this.#normalise(repaired);
        this.state=cached?this.#mergeStates(cached,guestState):guestState;
        this.#saveRecovery();
        if(cached||recoveredFromPrevious||JSON.stringify(saved)!==JSON.stringify(repaired))await this.persist(true);
        if(recoveredFromPrevious)this.#emit('ai:recovered',{source:'guest-previous'});
      }else if(cached){
        this.state=cached;this.#saveRecovery();
        await this.persist(true);
        this.#emit('ai:recovered',{source:'browser-recovery'});
      }else if(missing){
        this.state=this.#normalise(null);await this.persist(true);
      }else{
        throw readError||new Error('The Aeris AI data service did not return a state file.');
      }
      this.guestSynced=true;this.error='';
      this.#emit('ai:changed',{guestSynced:true});
    } catch (error) {
      this.syncError=error.message||String(error);
      this.#emit('ai:sync-error',{error:this.syncError});
      clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.load().catch(()=>{}),2500);
      throw error;
    } finally {
      this.loading = false;
    }
  }

  snapshot() {
    return {
      ready: this.ready,
      loading: this.loading,
      error: this.error,
      path: AI_STATE_PATH,
      guestSynced: this.guestSynced,
      syncError: this.syncError,
      config: { ...this.state.config, apiKey: this.state.config.apiKey ? '••••••••' : '' },
      sessions: this.state.sessions.map(session => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        streaming: Boolean(this.agents.get(session.id)?.state.isStreaming && !this.settlingSessions.has(session.id)),
      })).sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }

  config() { return { ...this.state.config, disabledToolApps: [...(this.state.config.disabledToolApps||[])] }; }

  toolApps() {
    const disabled=new Set(this.state.config.disabledToolApps||[]);
    return (this.toolService?.apps()||[]).map(app=>({...app,enabled:!disabled.has(app.id)}));
  }

  isToolAppEnabled(appId) { return !(this.state.config.disabledToolApps||[]).includes(appId); }

  async setToolAppEnabled(appId, enabled) {
    if(!this.toolService?.apps().some(app=>app.id===appId))throw new Error(`Unknown tool app: ${appId}`);
    const disabled=new Set(this.state.config.disabledToolApps||[]);
    enabled?disabled.delete(appId):disabled.add(appId);
    this.state.config.disabledToolApps=[...disabled];
    const activeTools=this.#activeTools();
    this.agents.forEach(agent=>{agent.state.tools=activeTools;});
    await this.persist();
    this.#emit('ai:tools-changed',{appId,enabled});
  }

  async updateConfig(changes) {
    const previous = this.state.config;
    this.state.config = {
      ...previous,
      ...changes,
      baseUrl: String(changes.baseUrl ?? previous.baseUrl).trim().replace(/\/+$/, ''),
      model: String(changes.model ?? previous.model).trim(),
      apiKey: String(changes.apiKey ?? previous.apiKey).trim(),
      systemPrompt: String(changes.systemPrompt ?? previous.systemPrompt).trim() || defaultConfig().systemPrompt,
    };
    this.agents.forEach(agent => agent.abort());
    this.agents.clear();
    this.queuedMessages.clear();this.activeTurns.clear();this.settlingSessions.clear();
    await this.persist();
    this.#emit('ai:changed');
  }

  createSession() {
    const stamp = now();
    const session = { id: crypto.randomUUID(), title: 'New chat', createdAt: stamp, updatedAt: stamp, messages: [], turns: [] };
    this.state.sessions.unshift(session);
    this.persist();
    this.#emit('ai:changed', { sessionId: session.id });
    return session.id;
  }

  renameSession(id, title) {
    const session = this.#session(id);
    session.title = String(title).trim().slice(0, 80) || session.title;
    session.updatedAt = now();
    this.persist();
    this.#emit('ai:changed', { sessionId: id });
  }

  deleteSession(id) {
    this.agents.get(id)?.abort();
    this.agents.delete(id);
    this.queuedMessages.delete(id);
    this.activeTurns.delete(id);
    this.settlingSessions.delete(id);
    this.state.sessions = this.state.sessions.filter(session => session.id !== id);
    this.persist();
    this.#emit('ai:changed', { sessionId: id });
  }

  sessionState(id) {
    const session = this.#session(id);
    const agent = this.agents.get(id);
    return {
      ...clone(session),
      messages: agent ? clone(agent.state.messages) : clone(session.messages),
      activeTurnId: this.activeTurns.get(id) || null,
      streamingMessage: agent?.state.streamingMessage ? clone(agent.state.streamingMessage) : null,
      streaming: Boolean(agent?.state.isStreaming && !this.settlingSessions.has(id)),
      error: agent?.state.errorMessage || '',
    };
  }

  async send(id, text) {
    const prompt = String(text).trim();
    if (!prompt) return;
    if (!this.ready) throw new Error('The AI service is waiting for the Linux system.');
    if (!this.state.config.apiKey) throw new Error('Add an API key in AI settings first.');
    if (!this.state.config.baseUrl || !this.state.config.model) throw new Error('The AI provider configuration is incomplete.');
    const agent = this.#agent(id), session=this.#session(id);
    if(this.settlingSessions.has(id))await agent.waitForIdle();
    this.settlingSessions.delete(id);
    const userMessage={role:'user',content:prompt,timestamp:now()};
    const turn={id:crypto.randomUUID(),createdAt:userMessage.timestamp,updatedAt:userMessage.timestamp,status:agent.state.isStreaming?'queued':'running',user:clone(userMessage),responses:[],messageIndex:null};
    session.turns.push(turn);session.updatedAt=userMessage.timestamp;
    if (agent.state.isStreaming) {
      this.queuedMessages.set(id,[...(this.queuedMessages.get(id)||[]),{turnId:turn.id,message:userMessage}]);
      try { agent.followUp(userMessage); }
      catch (error) {
        session.turns=session.turns.filter(item=>item.id!==turn.id);
        const pending=(this.queuedMessages.get(id)||[]).filter(item=>item.turnId!==turn.id);
        pending.length?this.queuedMessages.set(id,pending):this.queuedMessages.delete(id);
        throw error;
      }
      this.#saveRecovery();
      this.#emit('ai:agent-event', { sessionId: id, turnId:turn.id, event: { type: 'queued' } });
      try {
        await agent.waitForIdle();
      } finally {
        this.settlingSessions.delete(id);
        this.#emit('ai:agent-event', { sessionId: id, event: { type: 'agent_idle' } });
      }
      return;
    }
    this.activeTurns.set(id,turn.id);
    this.#saveRecovery();
    this.#emit('ai:agent-event', { sessionId:id, turnId:turn.id, event:{type:'turn_created'} });
    try {
      await agent.prompt(userMessage);
    } finally {
      this.settlingSessions.delete(id);
      // pi clears isStreaming only after all agent_end subscribers settle.
      // This event lets the UI observe the final idle state.
      this.#emit('ai:agent-event', { sessionId: id, event: { type: 'agent_idle' } });
    }
  }

  async editAndResend(id, turnId, text) {
    const prompt = String(text).trim();
    if (!prompt) return;
    if (!this.ready) throw new Error('The AI service is waiting for the Linux system.');
    if (!this.state.config.apiKey) throw new Error('Add an API key in AI settings first.');
    const agent = this.#agent(id), messages = agent.state.messages, session=this.#session(id);
    const turnIndex=session.turns.findIndex(turn=>turn.id===turnId),turn=session.turns[turnIndex];
    if(this.settlingSessions.has(id))await agent.waitForIdle();
    this.settlingSessions.delete(id);
    if (agent.state.isStreaming) throw new Error('Wait for the current response to finish first.');
    const index=Number.isInteger(turn?.messageIndex)?turn.messageIndex:messages.findIndex(message=>message.role==='user'&&message.timestamp===turn?.user?.timestamp);
    if(turnIndex>=0&&index<0&&turn?.status==='queued'){
      session.turns=session.turns.slice(0,turnIndex);
      const pending=(this.queuedMessages.get(id)||[]).filter(item=>item.turnId!==turn.id);pending.length?this.queuedMessages.set(id,pending):this.queuedMessages.delete(id);
      session.updatedAt=now();this.persist();this.#emit('ai:changed',{sessionId:id});return this.send(id,prompt);
    }
    if (turnIndex<0 || index<0 || messages[index]?.role !== 'user') throw new Error('This message can no longer be edited.');
    agent.state.messages = clone(messages.slice(0, index));
    session.messages = clone(agent.state.messages);
    session.turns=session.turns.slice(0,turnIndex);
    session.updatedAt = now();
    this.persist();
    this.#emit('ai:changed', { sessionId: id });
    return this.send(id,prompt);
  }

  abort(id) {
    const session=this.state.sessions.find(item=>item.id===id),activeId=this.activeTurns.get(id),queued=this.queuedMessages.get(id)||[];
    if(session){
      const queuedIds=new Set(queued.map(item=>item.turnId));
      session.turns=session.turns.filter(turn=>!queuedIds.has(turn.id));
      const active=session.turns.find(turn=>turn.id===activeId);if(active){active.status='stopped';active.updatedAt=now()}
    }
    this.queuedMessages.delete(id);this.activeTurns.delete(id);this.settlingSessions.delete(id);this.#saveRecovery();
    this.#emit('ai:agent-event', { sessionId: id, event: { type: 'queue_cleared' } });
    return this.agents.get(id)?.abort();
  }

  persist(requireGuest=false) {
    this.state.updatedAt=now();
    const payload = JSON.stringify(this.state);
    this.#saveRecovery();
    if(!this.system.ready){
      if(requireGuest)return Promise.reject(new Error('The Linux data service is not ready.'));
      return Promise.resolve(false);
    }
    this.persistChain = this.persistChain.catch(() => {}).then(async()=>{
      try{await this.system.exec?.(`[ ! -s '${AI_STATE_PATH}' ] || cp '${AI_STATE_PATH}' '${AI_PREVIOUS_STATE_PATH}'`,8000)}catch{}
      await (this.system.writeChunked?.(AI_STATE_PATH,payload)||this.system.write(AI_STATE_PATH,payload));
      this.system.machine?.scheduleCheckpoint?.(500);
      return true;
    });
    if(requireGuest)return this.persistChain;
    return this.persistChain.catch(error=>{this.syncError=error.message||String(error);this.guestSynced=false;clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.load().catch(()=>{}),2500);this.#emit('ai:sync-error',{error:this.syncError});return false});
  }

  async #readState(path) {
    let lastError;
    for(const delay of [0,350,900]){
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      try{return JSON.parse(await this.system.read(path))}catch(error){lastError=error;if(this.#isMissing(error))break}
    }
    throw lastError;
  }

  #isMissing(error){return /no such file|not found|can't open|cannot open/i.test(error?.message||'')}
  #loadRecovery(){try{const envelope=JSON.parse(this.storage?.getItem(AI_RECOVERY_KEY)||'null');return envelope?.state?this.#normalise(repairUtf8Tree(envelope.state)):null}catch{return null}}
  #saveRecovery(){try{this.storage?.setItem(AI_RECOVERY_KEY,JSON.stringify({savedAt:Date.now(),state:this.state}))}catch{}}
  #stateScore(state){return(state?.sessions?.length||0)*10+(state?.config?.apiKey?5:0)+(state?.config?.model?1:0)}
  #preferRecovery(cached,guest){const cachedAt=Number(cached?.updatedAt)||0,guestAt=Number(guest?.updatedAt)||0;return cachedAt>guestAt||(cachedAt===guestAt&&this.#stateScore(cached)>this.#stateScore(guest))}
  #mergeStates(cached,guest){
    const preferred=this.#preferRecovery(cached,guest)?cached:guest,other=preferred===cached?guest:cached,sessions=new Map();
    for(const session of [...(other.sessions||[]),...(preferred.sessions||[])]){const existing=sessions.get(session.id);if(!existing||(session.updatedAt||0)>=(existing.updatedAt||0))sessions.set(session.id,session)}
    return{...preferred,version:3,updatedAt:Math.max(Number(cached.updatedAt)||0,Number(guest.updatedAt)||0),sessions:[...sessions.values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))};
  }

  #agent(id) {
    if (this.agents.has(id)) return this.agents.get(id);
    const session = this.#session(id), config = this.state.config;
    const model = {
      id: config.model,
      name: config.model,
      api: 'openai-completions',
      provider: PROVIDER_ID,
      baseUrl: config.baseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    };
    const provider = createProvider({
      id: PROVIDER_ID,
      name: 'OpenAI compatible',
      baseUrl: config.baseUrl,
      auth: { apiKey: { name: 'API key', resolve: async () => ({ auth: { apiKey: this.state.config.apiKey }, source: 'Aeris AI settings' }) } },
      models: [model],
      api: openAICompletionsApi(),
    });
    const models = createModels();
    models.setProvider(provider);
    const agent = new Agent({
      sessionId: session.id,
      initialState: { systemPrompt: this.#systemPrompt(config.systemPrompt), model, messages: clone(session.messages), thinkingLevel: 'off', tools: this.#activeTools() },
      streamFn: (activeModel, context, options) => models.streamSimple(activeModel, context, { ...options, apiKey: this.state.config.apiKey }),
      followUpMode: 'one-at-a-time',
      steeringMode: 'one-at-a-time',
      maxRetryDelayMs: 12000,
    });
    agent.subscribe(async event => {
      if(event.type==='message_start'&&event.message?.role==='user'){
        const queued=this.queuedMessages.get(id)||[],index=queued.findIndex(item=>item.message.timestamp===event.message.timestamp||item.message.content===event.message.content);
        const previous=session.turns.find(turn=>turn.id===this.activeTurns.get(id));if(previous&&previous.status==='running'){previous.status='completed';previous.updatedAt=now()}
        let turn=index>=0?session.turns.find(item=>item.id===queued[index].turnId):session.turns.find(item=>item.user?.timestamp===event.message.timestamp);
        if(!turn){turn={id:crypto.randomUUID(),createdAt:event.message.timestamp||now(),updatedAt:now(),status:'running',user:clone(event.message),responses:[],messageIndex:null};session.turns.push(turn)}
        turn.status='running';turn.updatedAt=now();this.activeTurns.set(id,turn.id);
        if(index>=0){queued.splice(index,1);queued.length?this.queuedMessages.set(id,queued):this.queuedMessages.delete(id)}
      }
      if(event.type==='message_end'){
        const turn=session.turns.find(item=>item.id===this.activeTurns.get(id));
        if(turn&&event.message?.role==='user')turn.messageIndex=agent.state.messages.length-1;
        else if(turn&&['assistant','toolResult'].includes(event.message?.role)){turn.responses.push(clone(event.message));turn.updatedAt=now()}
      }
      if (event.type === 'agent_end') {
        this.settlingSessions.add(id);
        const turn=session.turns.find(item=>item.id===this.activeTurns.get(id));if(turn){turn.status=agent.state.errorMessage?'failed':'completed';turn.updatedAt=now()}
        this.activeTurns.delete(id);
        session.messages = clone(agent.state.messages);
        session.updatedAt = now();
        if (session.title === 'New chat') {
          const first = session.messages.find(message => message.role === 'user');
          const title = typeof first?.content === 'string' ? first.content : first?.content?.find(block => block.type === 'text')?.text;
          if (title) session.title = title.trim().replace(/\s+/g, ' ').slice(0, 44);
        }
        this.persist();
        this.#emit('ai:changed', { sessionId: id });
      }
      this.#emit('ai:agent-event', { sessionId: id, event });
    });
    this.agents.set(id, agent);
    return agent;
  }

  #session(id) {
    const session = this.state.sessions.find(item => item.id === id);
    if (!session) throw new Error(`Unknown AI session: ${id}`);
    return session;
  }

  #systemPrompt(configuredPrompt) {
    const now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `${configuredPrompt}\n\nYou are integrated into the Aeris operating system. Use the provided system tools when the user asks to inspect or change apps, files, settings, or Linux state. Never claim an operation succeeded unless its tool completed. Ask for missing required details. High-risk tools pause for Aeris user approval automatically. Current local date and time: ${now.toString()}. Timezone: ${timezone}.`;
  }

  #activeTools() {
    const disabled=new Set(this.state.config.disabledToolApps||[]);
    return (this.toolService?.agentTools()||[]).filter(tool=>!disabled.has(tool.name.replace(/^aeris_/,'')));
  }

  #normalise(saved) {
    const config = { ...defaultConfig(), ...(saved?.config || {}) };
    config.disabledToolApps=Array.isArray(config.disabledToolApps)?[...new Set(config.disabledToolApps.map(String))]:[];
    const sessions = Array.isArray(saved?.sessions) ? saved.sessions.filter(item => item?.id).map(item => ({
      id: String(item.id),
      title: String(item.title || 'New chat'),
      createdAt: Number(item.createdAt) || now(),
      updatedAt: Number(item.updatedAt) || now(),
      messages: Array.isArray(item.messages) ? item.messages : [],
      turns: Array.isArray(item.turns) ? item.turns.filter(turn=>turn?.id&&turn?.user).map(turn=>({
        id:String(turn.id),createdAt:Number(turn.createdAt)||now(),updatedAt:Number(turn.updatedAt)||now(),status:['running','queued'].includes(turn.status)?'stopped':String(turn.status||'completed'),
        user:turn.user,responses:Array.isArray(turn.responses)?turn.responses:[],messageIndex:Number.isInteger(turn.messageIndex)?turn.messageIndex:null,
      })) : [],
    })) : [];
    return { version: 3, updatedAt:Number(saved?.updatedAt)||0, config, sessions };
  }

  #emit(event, detail = {}) { this.kernel.bus.emit(event, { ...detail, state: this.snapshot() }); }
}
