const OPERATIONS={
  navigate:'browser_navigate',
  get_state:'browser_get_state',
  click:'browser_click',
  type:'browser_type',
  scroll:'browser_scroll',
  back:'browser_go_back',
  list_tabs:'browser_list_tabs',
  switch_tab:'browser_switch_tab',
  close_tab:'browser_close_tab',
  extract_content:'browser_extract_content',
};

const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};

export class BrowserAutomationService{
  constructor(client,chromium=null){this.client=client;this.chromium=chromium}
  status(){return{...this.client.status(),chromium:this.chromium?.status()||null,operations:Object.keys(OPERATIONS)}}
  async connect(){await this.chromium?.connect();await this.client.connect();return this.status()}
  async execute(operation,args={}){
    const tool=OPERATIONS[operation];if(!tool)throw new Error(`Unsupported browser operation: ${operation}`);
    await this.chromium?.connect();const result=await this.client.callTool(tool,object(args));
    return{operation,tool,result,browser:this.chromium?.status()||null};
  }
  view(){if(!this.chromium)throw new Error('Chromium view service is unavailable.');return this.chromium.view()}
  navigate(url){if(!this.chromium)throw new Error('Chromium view service is unavailable.');return this.chromium.navigate(url)}
  pointer(input){if(!this.chromium)throw new Error('Chromium view service is unavailable.');return this.chromium.pointer(object(input))}
  key(input){if(!this.chromium)throw new Error('Chromium view service is unavailable.');return this.chromium.key(object(input))}
  history(direction){if(!this.chromium)throw new Error('Chromium view service is unavailable.');return direction==='forward'?this.chromium.forward():this.chromium.back()}
  reload(){if(!this.chromium)throw new Error('Chromium view service is unavailable.');return this.chromium.reload()}
  subscribe(listener){if(!this.chromium)throw new Error('Chromium view service is unavailable.');return this.chromium.subscribe(listener)}
  async stop(){await this.client.stop();await this.chromium?.stop()}
}

export const BROWSER_OPERATIONS=Object.freeze({...OPERATIONS});
