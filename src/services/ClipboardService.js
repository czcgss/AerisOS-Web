const COPYABLE_SELECTOR='[data-copyable],.preview-workspace pre,.disk-dashboard,.process-table main,.contact-card dl,[data-file-location],.file-inspector dl,[data-calc-display],.file-load-error';
const editableTarget = target => target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && ['text','search','url','tel','email'].includes(target.type));

export class ClipboardService {
  constructor(){this.value=''}
  start() {}

  targetFor(node) {
    const target=node instanceof Element?node:null;
    if(!target)return null;
    if(editableTarget(target))return target;
    return target.closest(COPYABLE_SELECTOR);
  }

  selectionTarget() {
    const selection=getSelection(),node=selection?.anchorNode,parent=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
    return parent?.closest?.(COPYABLE_SELECTOR)||null;
  }

  textFor(node) {
    const target=this.selectionTarget()||this.targetFor(node);
    if(!target)return '';
    if(editableTarget(target)){
      const start=target.selectionStart??0,end=target.selectionEnd??0;
      return start===end?'':target.value.slice(start,end);
    }
    const selection=getSelection();
    if(!selection||selection.isCollapsed||!selection.rangeCount)return '';
    const range=selection.getRangeAt(0),ancestor=range.commonAncestorContainer;
    return (target.contains(ancestor.nodeType===Node.ELEMENT_NODE?ancestor:ancestor.parentElement)||ancestor===target)?selection.toString():'';
  }

  canSelect(node){return Boolean(this.targetFor(node))}

  selectAll(node) {
    const target=this.targetFor(node);
    if(!target)return false;
    if(editableTarget(target)){target.focus();target.select();return true}
    const selection=getSelection(),range=document.createRange();
    range.selectNodeContents(target);selection.removeAllRanges();selection.addRange(range);return true;
  }

  async copyFrom(node) {
    const text=this.textFor(node);
    return this.copyText(text);
  }

  async copyText(text) {
    if(!text)return false;
    this.value=text;
    let hostCopied=false;
    try{await navigator.clipboard.writeText(text);hostCopied=true}catch{
      const helper=document.createElement('textarea');helper.value=text;helper.setAttribute('readonly','');helper.style.cssText='position:fixed;left:-9999px;top:-9999px';document.body.appendChild(helper);helper.select();hostCopied=document.execCommand('copy');helper.remove();
    }
    this.kernel.bus.emit('clipboard:copied',{text,hostCopied});return true;
  }
}
