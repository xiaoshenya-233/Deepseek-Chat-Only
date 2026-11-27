(()=>{
  "use strict";
  let preview=null;
  const isEnglish=()=>(document.documentElement.lang||"").toLowerCase().startsWith("en");
  const text=(zh,en)=>isEnglish()?en:zh;
  window.deepseekChatAttachmentPreviews=window.deepseekChatAttachmentPreviews||new Map();

  function closePreview(){
    if(!preview){
      return;
    }
    preview.remove();
    preview=null;
    document.removeEventListener("keydown",onPreviewKeyDown,true);
  }

  function onPreviewKeyDown(event){
    if("Escape"===event.key){
      event.preventDefault();
      closePreview();
    }
  }

  function openPreview(image,href){
    closePreview();
    const overlay=document.createElement("div");
    overlay.className="attachment-preview-overlay";
    overlay.setAttribute("role","presentation");
    const dialog=document.createElement("section");
    dialog.className="attachment-preview-dialog";
    dialog.setAttribute("role","dialog");
    dialog.setAttribute("aria-modal","true");
    dialog.setAttribute("aria-label",text("图片预览","Image preview"));
    const close=document.createElement("button");
    close.type="button";
    close.className="attachment-preview-close";
    close.setAttribute("aria-label",text("关闭","Close"));
    close.textContent="×";
    close.addEventListener("click",closePreview);
    const content=document.createElement("img");
    content.className="attachment-preview-image";
    content.src=href||image.currentSrc||image.src;
    content.alt=image.alt||image.getAttribute("aria-label")||"";
    dialog.append(close,content);
    overlay.append(dialog);
    overlay.addEventListener("click",event=>{
      if(event.target===overlay){
        closePreview();
      }
    });
    document.body.append(overlay);
    preview=overlay;
    document.addEventListener("keydown",onPreviewKeyDown,true);
    close.focus();
  }

  document.addEventListener("click",event=>{
    const image=event.target.closest('img[src^="blob:"],img[src^="data:image/"]');
    if(!image){
      return;
    }
    const anchor=image.closest("a[href]");
    const href=anchor?.href||image.currentSrc||image.src;
    if(!href.startsWith("blob:")&&!href.startsWith("data:image/")){
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openPreview(image,href);
  },true);

  window.deepseekChatOpenAttachment=async(url,name)=>{
    const native=window.DeepseekNative;
    if(native&&typeof native.openAttachment==="function"){
      try{
        const response=await fetch(url);
        if(!response.ok){
          throw Error(`Unable to read attachment (${response.status})`);
        }
        const blob=await response.blob();
        if(blob.size>32*1024*1024){
          throw Error(text("附件过大，无法在此设备上打开。","This attachment is too large to open on this device."));
        }
        const data=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onerror=()=>reject(reader.error||Error("Unable to read attachment"));
          reader.onload=()=>resolve(String(reader.result).split(",",2)[1]||"");
          reader.readAsDataURL(blob);
        });
        native.openAttachment(name||"attachment",blob.type||"application/octet-stream",data);
      }catch(error){
        console.error("[attachments] Unable to open attachment in Android",error);
        const message=error instanceof Error&&error.message
          ?error.message
          :text("无法打开附件，请稍后重试。","Unable to open this attachment. Please try again.");
        if(typeof native?.showAttachmentError==="function"){
          native.showAttachmentError(message);
        }else{
          window.alert(message);
        }
      }
      return;
    }
    const opened=window.open(url,"_blank","noopener,noreferrer");
    if(!opened){
      window.location.assign(url);
    }
  };

  let gesture=null;
  const drawerOpen=()=>!!document.querySelector(".drawer-ac14ac");
  const toggleDrawer=open=>{
    const label=isEnglish()
      ?open?["Open sidebar","Show sidebar"]:["Close sidebar","Hide sidebar"]
      :open?["打开边栏"]:["收起边栏"];
    const button=[...document.querySelectorAll("button")]
      .find(item=>label.includes(item.getAttribute("aria-label"))||label.includes(item.title))
      ||document.querySelector(".sider-ac14ac .top-ac14ac button");
    button?.click();
  };

  document.addEventListener("touchstart",event=>{
    if(event.touches.length!==1){
      gesture=null;
      return;
    }
    const touch=event.touches[0];
    const drawer=event.target instanceof Element?event.target.closest(".drawer-ac14ac"):null;
    const closeFromDrawerEdge=!!drawer
      &&touch.clientX>=drawer.getBoundingClientRect().right-36;
    const fromEdge=touch.clientX<=40;
    gesture=(fromEdge||closeFromDrawerEdge)
      ?{x:touch.clientX,y:touch.clientY,close:closeFromDrawerEdge,active:false}
      :null;
  },{capture:true,passive:true});

  document.addEventListener("touchmove",event=>{
    if(!gesture||event.touches.length!==1){
      return;
    }
    const touch=event.touches[0];
    const dx=touch.clientX-gesture.x;
    const dy=touch.clientY-gesture.y;
    if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.3){
      gesture.active=gesture.close?dx<0:dx>0;
      if(gesture.active){
        event.preventDefault();
      }
    }
  },{capture:true,passive:false});

  document.addEventListener("touchend",event=>{
    if(!gesture){
      return;
    }
    const touch=event.changedTouches[0];
    const dx=touch.clientX-gesture.x;
    const dy=touch.clientY-gesture.y;
    if(gesture.active&&Math.abs(dx)>=56&&Math.abs(dx)>Math.abs(dy)*1.3){
      if(gesture.close&&dx<0&&drawerOpen()){
        toggleDrawer(false);
      }else if(!gesture.close&&dx>0&&!drawerOpen()){
        toggleDrawer(true);
      }
    }
    gesture=null;
  },{capture:true,passive:true});

  document.addEventListener("touchcancel",()=>{gesture=null},{capture:true,passive:true});
})();
