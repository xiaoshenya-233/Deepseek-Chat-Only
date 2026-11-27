(()=>{
  "use strict";
  let activeInput=null;
  let originalAttributes=null;
  let overlay=null;
  const isEnglish=()=>(document.documentElement.lang||"").toLowerCase().startsWith("en");
  const text=(zh,en)=>isEnglish()?en:zh;

  function getUploadInput(button){
    for(let node=button.parentElement,depth=0;node&&depth<6;node=node.parentElement,depth++){
      const input=node.querySelector('input[type="file"]');
      if(input){
        return input;
      }
    }
    return null;
  }

  function restoreInput(){
    if(!activeInput||!originalAttributes){
      return;
    }
    activeInput.accept=originalAttributes.accept;
    activeInput.multiple=originalAttributes.multiple;
    if(null===originalAttributes.capture){
      activeInput.removeAttribute("capture");
    }else{
      activeInput.setAttribute("capture",originalAttributes.capture);
    }
    originalAttributes=null;
    activeInput=null;
  }

  function closePicker(restore=false){
    if(overlay){
      overlay.remove();
      overlay=null;
    }
    document.removeEventListener("keydown",onKeyDown,true);
    if(restore){
      restoreInput();
    }
  }

  function onKeyDown(event){
    if("Escape"===event.key){
      event.preventDefault();
      closePicker(true);
    }
  }

  function choose(mode){
    const input=activeInput;
    if(!input){
      closePicker(true);
      return;
    }
    if("original"===mode){
      input.accept=originalAttributes.accept;
      input.multiple=originalAttributes.multiple;
      if(null===originalAttributes.capture){
        input.removeAttribute("capture");
      }else{
        input.setAttribute("capture",originalAttributes.capture);
      }
    }else{
      input.accept="image/*";
      input.multiple="gallery"===mode&&originalAttributes.multiple;
      if("camera"===mode){
        input.setAttribute("capture","environment");
      }else{
        input.removeAttribute("capture");
      }
    }
    input.addEventListener("change",()=>setTimeout(restoreInput,0),{capture:true,once:true});
    closePicker();
    requestAnimationFrame(()=>input.click());
  }

  function createOption(mode,icon,title,description){
    const button=document.createElement("button");
    button.className="attachment-picker-option";
    button.type="button";
    const symbol=document.createElement("span");
    symbol.className="attachment-picker-icon";
    symbol.setAttribute("aria-hidden","true");
    symbol.textContent=icon;
    const copy=document.createElement("span");
    copy.className="attachment-picker-copy";
    const heading=document.createElement("strong");
    heading.textContent=title;
    const detail=document.createElement("span");
    detail.textContent=description;
    copy.append(heading,detail);
    button.append(symbol,copy);
    button.addEventListener("click",()=>choose(mode));
    return button;
  }

  function openPicker(input){
    closePicker(true);
    activeInput=input;
    originalAttributes={
      accept:input.accept,
      multiple:input.multiple,
      capture:input.getAttribute("capture")
    };

    overlay=document.createElement("div");
    overlay.className="attachment-picker-overlay";
    overlay.dataset.attachmentPicker="";
    overlay.setAttribute("role","presentation");
    const dialog=document.createElement("section");
    dialog.className="attachment-picker-dialog";
    dialog.setAttribute("role","dialog");
    dialog.setAttribute("aria-modal","true");
    dialog.setAttribute("aria-labelledby","attachment-picker-title");
    const header=document.createElement("header");
    header.className="attachment-picker-header";
    const title=document.createElement("h2");
    title.id="attachment-picker-title";
    title.textContent=text("添加附件","Add attachment");
    const close=document.createElement("button");
    close.className="attachment-picker-close";
    close.type="button";
    close.setAttribute("aria-label",text("关闭","Close"));
    close.textContent="×";
    close.addEventListener("click",()=>closePicker(true));
    header.append(title,close);
    const options=document.createElement("div");
    options.className="attachment-picker-options";
    options.append(
      createOption("camera","📷",text("摄像头拍摄","Take a photo"),text("拍摄照片并作为附件上传","Capture and upload a photo")),
      createOption("gallery","🖼",text("图库","Photo library"),text("从图库中选择图片","Choose images from your library")),
      createOption("original","📄",text("文件","Choose files"),text("使用原有文件选择器","Use the original file picker"))
    );
    dialog.append(header,options);
    overlay.append(dialog);
    overlay.addEventListener("click",event=>{
      if(event.target===overlay){
        closePicker(true);
      }
    });
    document.body.append(overlay);
    document.addEventListener("keydown",onKeyDown,true);
    close.focus();
  }

  document.addEventListener("click",event=>{
    const button=event.target.closest('button[aria-label="上传文件"],button[aria-label="Upload file"]');
    if(!button||button.disabled){
      return;
    }
    const input=getUploadInput(button);
    if(!input){
      console.error("[attachments] Upload input not found");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openPicker(input);
  },true);
})();
