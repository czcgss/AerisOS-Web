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
  constructor(client){this.client=client}
  status(){return{...this.client.status(),operations:Object.keys(OPERATIONS)}}
  async connect(){await this.client.connect();return this.status()}
  async execute(operation,args={}){
    const tool=OPERATIONS[operation];if(!tool)throw new Error(`Unsupported browser operation: ${operation}`);
    const result=await this.client.callTool(tool,object(args));
    return{operation,tool,result};
  }
  stop(){return this.client.stop()}
}

export const BROWSER_OPERATIONS=Object.freeze({...OPERATIONS});
