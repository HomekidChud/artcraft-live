// Native blocking dialogs are unavailable in sandboxed review previews.
let queue=Promise.resolve(),sequence=0;
function openDialog({message,value,prompt}) {
  return new Promise(resolve=>{
    if(!document.getElementById('app-dialog-style')){
      const style=document.createElement('style');style.id='app-dialog-style';
      style.textContent=`
        .app-dialog{inset:0;margin:auto;width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:24px;border:1px solid var(--line,#383329);border-radius:14px;background:var(--panel,#211f1b);color:var(--text,#ece7dd);font:14px/1.5 'Outfit',system-ui,sans-serif;box-shadow:0 16px 60px #0008}
        .app-dialog::backdrop{background:#000b}
        .app-dialog h2{font-size:20px;font-weight:600;margin:0 0 12px}
        .app-dialog p{white-space:pre-wrap;margin:0 0 20px}
        .app-dialog label{display:grid;gap:8px;margin-bottom:20px}
        .app-dialog input{width:100%;min-height:42px;padding:8px 10px;background:var(--bg,#191714);color:inherit;border:1px solid var(--line,#383329);border-radius:6px;font:inherit}
        .app-dialog-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
        .app-dialog .btn{min-height:40px}
      `;document.head.append(style);
    }
    const dialog=document.createElement('dialog'),form=document.createElement('form'),heading=document.createElement('h2');
    dialog.className='app-dialog';heading.id='app-dialog-'+(++sequence);heading.textContent=prompt?'Enter a name':'Confirm action';
    dialog.setAttribute('aria-labelledby',heading.id);form.append(heading);let input;
    if(prompt){
      const label=document.createElement('label');label.textContent=message;
      input=document.createElement('input');input.type='text';input.value=String(value ?? '');input.maxLength=2000;
      label.append(input);form.append(label);
    }else{const text=document.createElement('p');text.id=heading.id+'-message';text.textContent=message;form.append(text);dialog.setAttribute('aria-describedby',text.id);}
    const actions=document.createElement('div'),cancel=document.createElement('button'),confirm=document.createElement('button');
    actions.className='app-dialog-actions';cancel.className='btn';cancel.type='button';cancel.textContent='Cancel';
    confirm.className='btn primary';confirm.type='submit';confirm.textContent=prompt?'Save name':'Confirm';
    actions.append(cancel,confirm);form.append(actions);dialog.append(form);document.body.append(dialog);
    let settled=false;
    const finish=accepted=>{
      if(settled)return;settled=true;
      const result=prompt?(accepted?input.value:null):accepted;
      dialog.close();dialog.remove();resolve(result);
    };
    form.addEventListener('submit',e=>{e.preventDefault();finish(true);});
    cancel.addEventListener('click',()=>finish(false));
    dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
    dialog.addEventListener('close',()=>finish(false));
    dialog.showModal();(input || cancel).focus();input?.select();
  });
}
function enqueue(options){const result=queue.then(()=>openDialog(options));queue=result.catch(()=>{});return result;}
export const askConfirm=message=>enqueue({message,prompt:false});
export const askName=(message,value='')=>enqueue({message,value,prompt:true});
