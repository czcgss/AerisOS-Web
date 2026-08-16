export class WidgetRegistry {
  constructor(){this.widgets=new Map();this.listeners=new Set()}
  register(widget){
    if(!widget?.id)throw new Error('Widgets require an id.');
    if(this.widgets.has(widget.id))throw new Error(`Widget already registered: ${widget.id}`);
    this.widgets.set(widget.id,Object.freeze({...widget,sizes:[...(widget.sizes||['medium'])]}));
    this.#emit({type:'registered',widget:this.widgets.get(widget.id)});return this;
  }
  replace(widget){
    if(!widget?.id||!this.widgets.has(widget.id))throw new Error(`Unknown widget: ${widget?.id||''}`);
    const previous=this.widgets.get(widget.id),next=Object.freeze({...widget,sizes:[...(widget.sizes||['medium'])]});this.widgets.set(widget.id,next);this.#emit({type:'updated',widget:next,previous});return this;
  }
  unregister(id){const widget=this.widgets.get(id);if(!widget)return false;this.widgets.delete(id);this.#emit({type:'unregistered',widget});return true}
  get(id){return this.widgets.get(id)}
  list(){return [...this.widgets.values()]}
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
  #emit(change){for(const listener of this.listeners)listener(change)}
}
