export class DialogService {
  constructor(root, i18n) {
    this.root = root;
    this.i18n = i18n;
    this.active = null;
  }

  prompt({ title, message = '', value = '', placeholder = '', validate } = {}) {
    this.active?.cancel();
    return new Promise(resolve => {
      const layer = document.createElement('section');
      layer.className = 'system-dialog-layer';
      layer.innerHTML = `<div class="system-dialog-backdrop"></div><form class="system-dialog" role="dialog" aria-modal="true" autocomplete="off" data-form-type="other"><header><strong>${title || this.i18n.t('newFolder')}</strong>${message ? `<p>${message}</p>` : ''}</header><input name="aeris-value" type="text" value="${this.#escape(value)}" placeholder="${this.#escape(placeholder)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore><small data-dialog-error></small><footer><button type="button" data-dialog-cancel>${this.i18n.t('cancel')}</button><button class="dialog-primary" type="submit">${this.i18n.t('create')}</button></footer></form>`;
      this.root.appendChild(layer);
      const input = layer.querySelector('input'), error = layer.querySelector('[data-dialog-error]');
      const finish = result => { if (!layer.isConnected) return; layer.remove(); this.active = null; resolve(result); };
      const cancel = () => finish(null);
      this.active = { cancel };
      layer.querySelector('[data-dialog-cancel]').onclick = cancel;
      layer.querySelector('.system-dialog-backdrop').onclick = cancel;
      layer.querySelector('form').onsubmit = event => {
        event.preventDefault();
        const result = input.value.trim(), problem = validate?.(result);
        if (problem) { error.textContent = problem; input.focus(); input.select(); return; }
        finish(result);
      };
      layer.onkeydown = event => { if (event.key === 'Escape') cancel(); };
      requestAnimationFrame(() => { input.focus(); input.select(); });
    });
  }

  confirm({ title, message = '', confirmLabel, danger = false } = {}) {
    this.active?.cancel();
    return new Promise(resolve => {
      const layer=document.createElement('section');layer.className='system-dialog-layer';
      layer.innerHTML=`<div class="system-dialog-backdrop"></div><form class="system-dialog" role="alertdialog" aria-modal="true"><header><strong>${this.#escape(title||'')}</strong><p>${this.#escape(message)}</p></header><footer><button type="button" data-dialog-cancel>${this.i18n.t('cancel')}</button><button class="dialog-primary ${danger?'dialog-danger':''}" type="submit">${this.#escape(confirmLabel||this.i18n.t('continue'))}</button></footer></form>`;
      this.root.appendChild(layer);const finish=value=>{if(!layer.isConnected)return;layer.remove();this.active=null;resolve(value)},cancel=()=>finish(false);this.active={cancel};
      layer.querySelector('[data-dialog-cancel]').onclick=cancel;layer.querySelector('.system-dialog-backdrop').onclick=cancel;layer.querySelector('form').onsubmit=event=>{event.preventDefault();finish(true)};layer.onkeydown=event=>{if(event.key==='Escape')cancel()};requestAnimationFrame(()=>layer.querySelector('[data-dialog-cancel]').focus());
    });
  }

  #escape(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
