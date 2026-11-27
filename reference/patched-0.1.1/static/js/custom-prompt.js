(()=>{
  "use strict";
  let dialog=null;
  let dialogObserver=null;
  let loadToken=0;

  function isEnglish(){
    return[...(dialog?.querySelectorAll('[role="tab"]')??[])].some(tab=>tab.innerText.trim()==="Data management");
  }

  function label(chinese,english){
    return isEnglish()?english:chinese;
  }

  function setStatus(element,message,isError=false){
    element.textContent=message;
    element.dataset.state=isError?"error":"saved";
  }

  function openDatabase(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open("chat-demo");
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error??Error("Unable to open the conversation database"));
      request.onblocked=()=>reject(Error("The conversation database is blocked by another tab"));
    });
  }

  async function loadSessions(section){
    const select=section.querySelector("[data-conversation-select]");
    const status=section.querySelector("[data-list-status]");
    const selectedId=select.value;
    const token=++loadToken;
    select.disabled=true;
    status.textContent=label("正在读取对话列表…","Loading conversations…");
    try{
      const database=await openDatabase();
      let sessions;
      try{
        if(!database.objectStoreNames.contains("sessionSummaries")){
          throw Error("The conversation index is unavailable");
        }
        sessions=await new Promise((resolve,reject)=>{
          const transaction=database.transaction("sessionSummaries","readonly");
          const request=transaction.objectStore("sessionSummaries").getAll();
          request.onsuccess=()=>resolve(request.result);
          request.onerror=()=>reject(request.error??Error("Unable to read conversations"));
          transaction.onabort=()=>reject(transaction.error??Error("Conversation list read was aborted"));
        });
      }finally{
        database.close();
      }
      if(token!==loadToken||!section.isConnected){
        return;
      }
      sessions.sort((left,right)=>(right.updatedAt??0)-(left.updatedAt??0));
      window.deepseekChatContextStore.migrateLegacyPrompt(sessions.map(session=>session.id));
      select.replaceChildren(new Option(label("请选择对话","Select a conversation"),""));
      for(const session of sessions){
        if("string"!=typeof session.id||!session.id){
          continue;
        }
        const option=new Option(session.title||label("未命名对话","Untitled conversation"),session.id);
        select.add(option);
      }
      if(sessions.some(session=>session.id===selectedId)){
        select.value=selectedId;
      }else if(select.options.length>1){
        select.selectedIndex=1;
      }
      select.disabled=false;
      status.textContent=sessions.length
        ?label(`共 ${sessions.length} 个对话` ,`${sessions.length} conversations`)
        :label("暂无对话","No conversations yet");
      await loadConversation(section);
    }catch(error){
      if(token!==loadToken||!section.isConnected){
        return;
      }
      console.error("[settings] Failed to load conversations",error);
      status.textContent=label("读取对话列表失败，请重试","Could not load conversations. Please retry.");
      status.dataset.state="error";
      select.disabled=true;
    }
  }

  async function loadConversation(section){
    const token=++loadToken;
    const select=section.querySelector("[data-conversation-select]");
    const sessionId=select.value;
    const prompt=section.querySelector("[data-conversation-prompt]");
    const summary=section.querySelector("[data-conversation-summary]");
    const promptStatus=section.querySelector("[data-prompt-status]");
    const summaryStatus=section.querySelector("[data-summary-status]");
    const metadata=section.querySelector("[data-summary-metadata]");
    const clearButton=section.querySelector("[data-clear-summary]");
    const summaryEnabled=section.querySelector("[data-summary-enabled]");
    const summaryPreferenceStatus=section.querySelector("[data-summary-preference-status]");
    section.dataset.selectedSessionId="";
    prompt.value="";
    summary.value="";
    prompt.disabled=!sessionId;
    summary.disabled=!sessionId;
    summaryEnabled.disabled=!sessionId;
    summaryPreferenceStatus.textContent="";
    metadata.textContent="";
    clearButton.disabled=true;
    if(!sessionId){
      promptStatus.textContent="";
      summaryStatus.textContent="";
      return;
    }
    try{
      const conversation=window.deepseekChatContextStore.getConversation(sessionId);
      if(token!==loadToken||!section.isConnected||select.value!==sessionId){
        return;
      }
      prompt.value=conversation.prompt;
      prompt.disabled=false;
      section.dataset.selectedSessionId=sessionId;
      summaryEnabled.checked=conversation.summaryEnabled;
      promptStatus.textContent="";
      if(conversation.summary){
        summary.value=conversation.summary.text;
        summary.disabled=false;
        clearButton.disabled=false;
        metadata.textContent=label(
          `已整理至消息 ${conversation.summary.throughId} · 指纹 ${conversation.summary.fingerprint}`,
          `Through message ${conversation.summary.throughId} · fingerprint ${conversation.summary.fingerprint}`
        );
        summaryStatus.textContent="";
      }else{
        summary.disabled=true;
        summaryStatus.textContent=label("此对话尚无自动摘要。","This conversation has no generated summary yet.");
      }
      if(!conversation.summaryEnabled){
        summaryPreferenceStatus.textContent=label(
          "自动摘要已关闭，已有摘要已清空。",
          "Automatic summaries are off and the saved summary has been cleared."
        );
      }
    }catch(error){
      console.error("[settings] Failed to load conversation context",error);
      prompt.disabled=true;
      summary.disabled=true;
      promptStatus.textContent=label("读取提示词失败","Could not load prompt");
      promptStatus.dataset.state="error";
      summaryStatus.textContent=label("读取摘要失败","Could not load summary");
      summaryStatus.dataset.state="error";
    }
  }

  function createSection(panel){
    const section=document.createElement("section");
    section.className="custom-prompt-section conversation-context-section";
    section.dataset.conversationContextSection="";
    const title=document.createElement("h3");
    title.className="custom-prompt-title";
    const description=document.createElement("p");
    description.className="custom-prompt-description";
    const picker=document.createElement("div");
    picker.className="conversation-context-picker";
    const selectLabel=document.createElement("label");
    const select=document.createElement("select");
    select.className="conversation-context-select";
    select.dataset.conversationSelect="";
    select.id="conversation-context-select";
    select.setAttribute("aria-label",label("选择要管理的对话","Choose a conversation to manage"));
    selectLabel.append(select);
    const reload=document.createElement("button");
    reload.className="conversation-context-button";
    reload.type="button";
    reload.dataset.reloadConversations="";
    reload.textContent=label("刷新列表","Refresh");
    const listStatus=document.createElement("div");
    listStatus.className="custom-prompt-status";
    listStatus.dataset.listStatus="";
    picker.append(selectLabel,reload);

    const promptHeading=document.createElement("h4");
    promptHeading.className="conversation-context-heading";
    promptHeading.id="conversation-context-prompt-heading";
    const promptInput=document.createElement("textarea");
    promptInput.className="custom-prompt-input";
    promptInput.dataset.conversationPrompt="";
    promptInput.setAttribute("aria-labelledby",promptHeading.id);
    promptInput.rows=5;
    promptInput.spellcheck=true;
    const promptActions=document.createElement("div");
    promptActions.className="conversation-context-actions";
    const savePrompt=document.createElement("button");
    savePrompt.className="conversation-context-button primary";
    savePrompt.type="button";
    savePrompt.dataset.savePrompt="";
    const promptStatus=document.createElement("div");
    promptStatus.className="custom-prompt-status";
    promptStatus.dataset.promptStatus="";
    promptActions.append(savePrompt,promptStatus);

    const summaryHeading=document.createElement("h4");
    summaryHeading.className="conversation-context-heading";
    summaryHeading.id="conversation-context-summary-heading";
    const preferenceLabel=document.createElement("label");
    preferenceLabel.className="conversation-summary-toggle";
    const summaryEnabled=document.createElement("input");
    summaryEnabled.type="checkbox";
    summaryEnabled.dataset.summaryEnabled="";
    const preferenceText=document.createElement("span");
    preferenceLabel.append(summaryEnabled,preferenceText);
    const preferenceStatus=document.createElement("div");
    preferenceStatus.className="custom-prompt-status";
    preferenceStatus.dataset.summaryPreferenceStatus="";
    const metadata=document.createElement("p");
    metadata.className="conversation-context-metadata";
    metadata.dataset.summaryMetadata="";
    const summaryInput=document.createElement("textarea");
    summaryInput.className="custom-prompt-input";
    summaryInput.dataset.conversationSummary="";
    summaryInput.setAttribute("aria-labelledby",summaryHeading.id);
    summaryInput.rows=8;
    summaryInput.spellcheck=true;
    const summaryActions=document.createElement("div");
    summaryActions.className="conversation-context-actions";
    const saveSummary=document.createElement("button");
    saveSummary.className="conversation-context-button primary";
    saveSummary.type="button";
    saveSummary.dataset.saveSummary="";
    const clearSummary=document.createElement("button");
    clearSummary.className="conversation-context-button danger";
    clearSummary.type="button";
    clearSummary.dataset.clearSummary="";
    const summaryStatus=document.createElement("div");
    summaryStatus.className="custom-prompt-status";
    summaryStatus.dataset.summaryStatus="";
    summaryActions.append(saveSummary,clearSummary,summaryStatus);

    section.append(title,description,picker,listStatus,promptHeading,promptInput,promptActions,summaryHeading,preferenceLabel,preferenceStatus,metadata,summaryInput,summaryActions);
    panel.append(section);

    title.textContent=label("对话提示词与摘要","Conversation prompts and summaries");
    description.textContent=label(
      "每个对话分别保存提示词与长上下文摘要。选择对话后可查看、编辑或清除对应数据。",
      "Prompts and long-context summaries are stored separately for each conversation. Select a conversation to view, edit, or clear its data."
    );
    promptHeading.textContent=label("自定义提示词","Custom prompt");
    promptInput.placeholder=label("此提示词仅用于所选对话…","Instructions for this conversation only…");
    savePrompt.textContent=label("保存提示词","Save prompt");
    summaryHeading.textContent=label("长上下文摘要","Long-context summary");
    preferenceText.textContent=label("自动生成摘要","Generate summaries automatically");
    summaryInput.placeholder=label("摘要文本…","Summary text…");
    saveSummary.textContent=label("保存摘要","Save summary");
    clearSummary.textContent=label("清除摘要","Clear summary");

    let promptTimer;
    const persistPrompt=()=>{
      clearTimeout(promptTimer);
      const sessionId=section.dataset.selectedSessionId;
      if(!sessionId||promptInput.disabled){
        return;
      }
      try{
        window.deepseekChatContextStore.setCustomPrompt(sessionId,promptInput.value);
        setStatus(promptStatus,label("提示词已保存","Prompt saved"));
      }catch(error){
        console.error("[settings] Failed to save conversation prompt",error);
        setStatus(promptStatus,label("保存提示词失败","Could not save prompt"),true);
      }
    };
    promptInput.addEventListener("input",()=>{
      promptStatus.textContent=label("正在保存…","Saving…");
      promptStatus.dataset.state="saving";
      clearTimeout(promptTimer);
      promptTimer=setTimeout(persistPrompt,300);
    });
    promptInput.addEventListener("blur",persistPrompt);
    savePrompt.addEventListener("click",persistPrompt);
    select.addEventListener("change",()=>{
      clearTimeout(promptTimer);
      persistPrompt();
      loadConversation(section);
    });
    reload.addEventListener("click",()=>loadSessions(section));
    summaryEnabled.addEventListener("change",()=>{
      const sessionId=section.dataset.selectedSessionId;
      if(!sessionId){
        return;
      }
      try{
        window.deepseekChatContextStore.setSummaryEnabled(sessionId,summaryEnabled.checked);
      if(!summaryEnabled.checked){
        summary.value="";
        summary.disabled=true;
        metadata.textContent="";
        clearSummary.disabled=true;
      }
      preferenceStatus.textContent=summaryEnabled.checked
        ?label("自动摘要已开启。","Automatic summaries are enabled.")
        :label("自动摘要已关闭，已有摘要已清空。","Automatic summaries are off and the saved summary has been cleared.");
      preferenceStatus.dataset.state="saved";
      }catch(error){
        console.error("[settings] Failed to save summary preference",error);
        preferenceStatus.textContent=label("保存摘要设置失败","Could not save summary preference");
        preferenceStatus.dataset.state="error";
        summaryEnabled.checked=!summaryEnabled.checked;
      }
    });
    saveSummary.addEventListener("click",()=>{
      const sessionId=select.value;
      if(!sessionId){
        return;
      }
      try{
        const current=window.deepseekChatContextStore.getSummary(sessionId);
        if(!current){
          setStatus(summaryStatus,label("此对话尚无摘要，无法保存。","There is no summary to save."),true);
          return;
        }
        window.deepseekChatContextStore.setSummary(sessionId,{...current,text:summaryInput.value});
        setStatus(summaryStatus,label("摘要已保存","Summary saved"));
      }catch(error){
        console.error("[settings] Failed to save conversation summary",error);
        setStatus(summaryStatus,label("保存摘要失败","Could not save summary"),true);
      }
    });
    clearSummary.addEventListener("click",()=>{
      const sessionId=select.value;
      if(!sessionId){
        return;
      }
      try{
        window.deepseekChatContextStore.setSummary(sessionId,null);
        loadConversation(section);
      }catch(error){
        console.error("[settings] Failed to clear conversation summary",error);
        setStatus(summaryStatus,label("清除摘要失败","Could not clear summary"),true);
      }
    });
    section.hidden=true;
    return section;
  }

  function updateSection(){
    if(!dialog){
      return;
    }
    const selectedTab=dialog.querySelector('[role="tab"][aria-selected="true"]');
    const text=(selectedTab?.innerText??"").trim();
    const isData="数据管理"===text||"Data management"===text;
    const panel=dialog.querySelector('[role="tabpanel"]');
    if(!panel){
      return;
    }
    let section=panel.querySelector("[data-conversation-context-section]");
    if(!section){
      section=createSection(panel);
    }
    if(panel.lastElementChild!==section){
      panel.append(section);
    }
    section.hidden=!isData;
    if(isData&&!section.dataset.loaded){
      section.dataset.loaded="true";
      loadSessions(section);
    }
  }

  function syncDialog(){
    const currentDialog=document.querySelector('[role="dialog"]');
    if(!currentDialog){
      dialogObserver?.disconnect();
      dialogObserver=null;
      dialog=null;
      return;
    }
    if(currentDialog!==dialog){
      dialogObserver?.disconnect();
      dialog=currentDialog;
      dialogObserver=new MutationObserver(updateSection);
      dialogObserver.observe(dialog,{
        subtree:true,
        childList:true,
        attributes:true,
        attributeFilter:["aria-selected"]
      });
    }
    updateSection();
  }

  new MutationObserver(syncDialog).observe(document.body,{childList:true});
  syncDialog();
})();
