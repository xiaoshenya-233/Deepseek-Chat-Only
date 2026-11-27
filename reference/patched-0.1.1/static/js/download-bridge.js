(()=>{
  "use strict";

  // 把页面里由 <a download> 触发的 blob 下载交给原生保存。
  // 桌面浏览器里没有 DeepseekNative，本脚本直接不生效，保持原生下载行为。

  const native=()=>window.DeepseekNative;
  const supported=()=>{
    const n=native();
    return !!(n&&typeof n.beginDownload==="function"&&typeof n.writeDownload==="function"
      &&typeof n.endDownload==="function");
  };
  if(!supported()){
    return;
  }

  const CHUNK_BYTES=512*1024;
  const blobUrls=new Map();
  const pendingTargets=new Map();
  const isEnglish=()=>(document.documentElement.lang||"").toLowerCase().startsWith("en");
  const text=(zh,en)=>isEnglish()?en:zh;
  const defaultName=()=>"deepseek_data.zip";

  const originalCreateObjectURL=URL.createObjectURL.bind(URL);
  URL.createObjectURL=value=>{
    const url=originalCreateObjectURL(value);
    if(value instanceof Blob){
      blobUrls.set(url,value);
    }
    return url;
  };

  const originalRevokeObjectURL=URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL=url=>{
    originalRevokeObjectURL(url);
    // 页面下载后会 revoke，但保存仍需要 Blob 本体，稍后再释放引用。
    setTimeout(()=>blobUrls.delete(url),5*60*1000);
  };

  window.__deepseekDownloadTarget=(ticket,ok,message)=>{
    const resolve=pendingTargets.get(ticket);
    if(!resolve){
      return;
    }
    pendingTargets.delete(ticket);
    resolve({ok:!!ok,message:typeof message==="string"?message:""});
  };

  window.__deepseekDownloadByUrl=(url,name)=>{
    const blob=blobUrls.get(url);
    if(blob){
      void saveBlob(name||defaultName(),blob);
    }
  };

  let toastTimer=null;
  function toast(message,isError=false){
    let element=document.getElementById("deepseek-download-toast");
    if(!element){
      element=document.createElement("div");
      element.id="deepseek-download-toast";
      element.setAttribute("role","status");
      element.setAttribute("aria-live","polite");
      element.style.cssText=[
        "position:fixed","left:50%","bottom:max(24px,env(safe-area-inset-bottom))",
        "transform:translateX(-50%)","max-width:min(88vw,420px)","padding:10px 16px",
        "border-radius:12px","font-size:14px","line-height:20px","z-index:2147483000",
        "box-shadow:0 6px 24px rgba(0,0,0,.18)","pointer-events:none",
        "font-family:inherit","text-align:center","word-break:break-word"
      ].join(";");
      document.body.appendChild(element);
    }
    element.textContent=message;
    const dark=document.querySelector("[data-ds-dark-theme]")!==null;
    element.style.background=isError?(dark?"#4a1d1d":"#fdecec"):(dark?"#2a2a2a":"#ffffff");
    element.style.color=isError?(dark?"#ffb4b4":"#b42318"):(dark?"#e6e6e6":"#1f2328");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{
      element.remove();
      toastTimer=null;
    },isError?4200:2600);
  }

  let overlay=null;
  let overlayBar=null;
  let overlayDetail=null;

  function formatSize(bytes){
    if(!Number.isFinite(bytes)||bytes<0){
      return "";
    }
    if(bytes<1024){
      return `${bytes} B`;
    }
    const units=["KB","MB","GB"];
    let value=bytes/1024;
    let unit=units[0];
    for(let index=1;value>=1024&&index<units.length;index+=1){
      value/=1024;
      unit=units[index];
    }
    return `${value.toFixed(1)} ${unit}`;
  }

  function showProgress(name,total){
    closeProgress();
    const dark=document.querySelector("[data-ds-dark-theme]")!==null;
    overlay=document.createElement("div");
    overlay.setAttribute("role","status");
    overlay.setAttribute("aria-live","polite");
    overlay.style.cssText=[
      "position:fixed","left:50%","bottom:max(24px,env(safe-area-inset-bottom))",
      "transform:translateX(-50%)","width:min(88vw,420px)","padding:14px 16px",
      "border-radius:14px","z-index:2147483000","pointer-events:none",
      "box-shadow:0 10px 32px rgba(0,0,0,.22)","font-family:inherit",
      "background:"+(dark?"#2a2a2a":"#ffffff"),
      "color:"+(dark?"#e6e6e6":"#1f2328")
    ].join(";");
    const title=document.createElement("div");
    title.style.cssText="font-size:14px;line-height:20px;font-weight:500;margin-bottom:8px;";
    title.textContent=text("正在导出：","Exporting: ")+name;
    const track=document.createElement("div");
    track.style.cssText="height:6px;border-radius:999px;overflow:hidden;background:"
      +(dark?"#3a3a3a":"#eceff3")+";";
    overlayBar=document.createElement("div");
    overlayBar.style.cssText="height:100%;width:0%;border-radius:999px;background:#4d6bfe;"
      +"transition:width .2s ease;";
    track.appendChild(overlayBar);
    overlayDetail=document.createElement("div");
    overlayDetail.style.cssText="margin-top:8px;font-size:12px;line-height:18px;opacity:.7;";
    overlayDetail.textContent=`0% · 0 B / ${formatSize(total)}`;
    overlay.append(title,track,overlayDetail);
    document.body.appendChild(overlay);
  }

  function updateProgress(done,total){
    if(!overlay){
      return;
    }
    const percent=total>0?Math.min(100,Math.round(done/total*100)):0;
    overlayBar.style.width=`${percent}%`;
    overlayDetail.textContent=`${percent}% · ${formatSize(done)} / ${formatSize(total)}`;
  }

  function closeProgress(message,isError=false){
    if(overlay){
      overlay.remove();
      overlay=null;
      overlayBar=null;
      overlayDetail=null;
    }
    if(message){
      toast(message,isError);
    }
  }

  function toBase64(bytes){
    let output="";
    const step=0x8000;
    for(let index=0;index<bytes.length;index+=step){
      output+=String.fromCharCode.apply(null,bytes.subarray(index,index+step));
    }
    return btoa(output);
  }

  function writeChunk(ticket,bytes){
    return native().writeDownload(ticket,toBase64(bytes))===true;
  }

  async function streamBlob(ticket,blob){
    let written=0;
    if(blob.stream&&typeof blob.stream==="function"){
      const reader=blob.stream().getReader();
      const buffer=new Uint8Array(CHUNK_BYTES);
      let filled=0;
      try{
        for(;;){
          const {done,value}=await reader.read();
          if(done){
            break;
          }
          let offset=0;
          while(offset<value.length){
            const take=Math.min(CHUNK_BYTES-filled,value.length-offset);
            buffer.set(value.subarray(offset,offset+take),filled);
            filled+=take;
            offset+=take;
            if(filled===CHUNK_BYTES){
              if(!writeChunk(ticket,buffer)){
                throw new Error("write failed");
              }
              written+=filled;
              filled=0;
              updateProgress(written,blob.size);
            }
          }
        }
      }finally{
        try{
          await reader.cancel();
        }catch{}
        if(typeof reader.releaseLock==="function"){
          reader.releaseLock();
        }
      }
      if(filled>0){
        if(!writeChunk(ticket,buffer.subarray(0,filled))){
          throw new Error("write failed");
        }
        written+=filled;
        updateProgress(written,blob.size);
      }
    }else{
      const bytes=new Uint8Array(await blob.arrayBuffer());
      for(let index=0;index<bytes.length;index+=CHUNK_BYTES){
        const slice=bytes.subarray(index,Math.min(index+CHUNK_BYTES,bytes.length));
        if(!writeChunk(ticket,slice)){
          throw new Error("write failed");
        }
        written+=slice.length;
        updateProgress(written,blob.size);
      }
    }
    if(written!==blob.size){
      throw new Error("size mismatch");
    }
  }

  async function saveBlob(name,blob){
    const ticket=`dl${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
    const ready=new Promise(resolve=>pendingTargets.set(ticket,resolve));
    try{
      native().beginDownload(ticket,String(name||defaultName()),
        String(blob.type||"application/zip"),String(blob.size));
    }catch(error){
      pendingTargets.delete(ticket);
      toast(text("无法启动导出","Unable to start export"),true);
      return;
    }
    const target=await ready;
    if(!target.ok){
      if(target.message){
        toast(target.message,true);
      }
      return;
    }
    showProgress(String(name||defaultName()),blob.size);
    try{
      await streamBlob(ticket,blob);
      const finished=native().endDownload(ticket)===true;
      closeProgress(finished
        ?text("已保存：","Saved: ")+String(name||defaultName())
        :text("保存失败","Save failed"),!finished);
    }catch(error){
      try{
        native().cancelDownload(ticket);
      }catch{}
      closeProgress(text("导出失败，请重试","Export failed, please retry"),true);
    }
  }

  // 页面导出用的是“创建隐藏 <a download> 再 click()”，这里在原型层拦截。
  const originalClick=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){
    const name=typeof this.download==="string"?this.download:"";
    const href=typeof this.href==="string"?this.href:"";
    if(name&&href.startsWith("blob:")){
      const blob=blobUrls.get(href);
      if(blob){
        void saveBlob(name,blob);
        return;
      }
    }
    return originalClick.apply(this,arguments);
  };
})();
