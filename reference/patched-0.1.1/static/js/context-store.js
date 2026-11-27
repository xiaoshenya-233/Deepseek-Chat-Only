(()=>{
  "use strict";
  const STORE_KEY="deepseek-chat-context-data-v1";
  const LEGACY_PREFIX="deepseek-chat-context-summary-v1:";

  function createEmptyRecord(){
    return{version:2,legacyPrompt:"",conversations:Object.create(null)};
  }

  function validateSummary(summary){
    if(!summary||1!==summary.version||"string"!=typeof summary.throughId||"string"!=typeof summary.fingerprint||"string"!=typeof summary.text){
      throw Error("Conversation summary has an invalid format");
    }
    return{version:1,throughId:summary.throughId,fingerprint:summary.fingerprint,text:summary.text};
  }

  function validateConversation(conversation){
    if(!conversation||"object"!=typeof conversation||Array.isArray(conversation)){
      throw Error("Conversation context has an invalid format");
    }
    const result={};
    if(void 0!==conversation.prompt){
      if("string"!=typeof conversation.prompt){
        throw Error("Conversation prompt has an invalid format");
      }
      result.prompt=conversation.prompt;
    }
    if(null!=conversation.summary){
      result.summary=validateSummary(conversation.summary);
    }
    if(void 0!==conversation.summaryEnabled){
      if("boolean"!=typeof conversation.summaryEnabled){
        throw Error("Conversation summary preference has an invalid format");
      }
      result.summaryEnabled=conversation.summaryEnabled;
    }
    return result;
  }

  function setOwn(target,key,value){
    Object.defineProperty(target,key,{value,enumerable:true,configurable:true,writable:true});
  }

  function saveRecord(record){
    localStorage.setItem(STORE_KEY,JSON.stringify(record));
    for(let i=localStorage.length-1;i>=0;i--){
      const key=localStorage.key(i);
      key?.startsWith(LEGACY_PREFIX)&&localStorage.removeItem(key);
    }
  }

  function migrateLegacySummaries(record){
    const keys=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      key?.startsWith(LEGACY_PREFIX)&&keys.push(key);
    }
    for(const key of keys){
      const sessionId=key.slice(LEGACY_PREFIX.length);
      try{
        const existing=record.conversations[sessionId]??{};
        if(!existing.summary){
          const conversation=validateConversation(existing);
          conversation.summary=validateSummary(JSON.parse(localStorage.getItem(key)));
          setOwn(record.conversations,sessionId,conversation);
        }
      }catch(error){
        console.error("[context] Unable to migrate legacy summary",key,error);
      }
    }
  }

  function loadRecord(){
    const stored=localStorage.getItem(STORE_KEY);
    if(null===stored){
      const record=createEmptyRecord();
      migrateLegacySummaries(record);
      saveRecord(record);
      return record;
    }

    const saved=JSON.parse(stored);
    if(!saved||!saved.conversations&&2===saved.version){
      throw Error("Conversation context data has an invalid format");
    }
    if(1===saved.version){
      if("string"!=typeof saved.customPrompt||!saved.summaries||"object"!=typeof saved.summaries||Array.isArray(saved.summaries)){
        throw Error("Conversation context data has an invalid format");
      }
      const record=createEmptyRecord();
      record.legacyPrompt=saved.customPrompt;
      for(const [sessionId,summary]of Object.entries(saved.summaries)){
        const conversation={};
        try{
          conversation.summary=validateSummary(summary);
        }catch(error){
          console.error("[context] Unable to migrate saved summary",sessionId,error);
        }
        setOwn(record.conversations,sessionId,conversation);
      }
      migrateLegacySummaries(record);
      saveRecord(record);
      return record;
    }
    if(2!==saved.version||"string"!=typeof saved.legacyPrompt||!saved.conversations||"object"!=typeof saved.conversations||Array.isArray(saved.conversations)){
      throw Error("Conversation context data has an invalid format");
    }

    const record=createEmptyRecord();
    record.legacyPrompt=saved.legacyPrompt;
    for(const [sessionId,conversation]of Object.entries(saved.conversations)){
      setOwn(record.conversations,sessionId,validateConversation(conversation));
    }
    migrateLegacySummaries(record);
    return record;
  }

  function getConversation(record,sessionId){
    if("string"!=typeof sessionId||!sessionId){
      throw TypeError("Conversation session ID must be a non-empty string");
    }
    return record.conversations[sessionId]??{};
  }

  function saveConversation(record,sessionId,conversation){
    setOwn(record.conversations,sessionId,conversation);
    saveRecord(record);
  }

  window.deepseekChatContextStore=Object.freeze({
    getCustomPrompt(sessionId){
      const record=loadRecord();
      const conversation=validateConversation(getConversation(record,sessionId));
      if(void 0===conversation.prompt){
        conversation.prompt=record.legacyPrompt;
        saveConversation(record,sessionId,conversation);
      }
      return conversation.prompt;
    },
    setCustomPrompt(sessionId,prompt){
      if("string"!=typeof prompt){
        throw TypeError("Custom prompt must be a string");
      }
      const record=loadRecord();
      const conversation=validateConversation(getConversation(record,sessionId));
      conversation.prompt=prompt;
      saveConversation(record,sessionId,conversation);
    },
    migrateLegacyPrompt(sessionIds){
      if(!Array.isArray(sessionIds)){
        throw TypeError("Conversation session IDs must be an array");
      }
      const record=loadRecord();
      const validIds=sessionIds.filter(sessionId=>"string"==typeof sessionId&&sessionId);
      if(!validIds.length){
        return;
      }
      for(const sessionId of validIds){
        const conversation=validateConversation(getConversation(record,sessionId));
        if(void 0===conversation.prompt){
          conversation.prompt=record.legacyPrompt;
          setOwn(record.conversations,sessionId,conversation);
        }
      }
      record.legacyPrompt="";
      saveRecord(record);
    },
    getSummary(sessionId){
      const summary=getConversation(loadRecord(),sessionId).summary;
      return summary?{...validateSummary(summary)}:null;
    },
    getSummaryEnabled(sessionId){
      const conversation=validateConversation(getConversation(loadRecord(),sessionId));
      return void 0!==conversation.summaryEnabled?conversation.summaryEnabled:true;
    },
    setSummaryEnabled(sessionId,enabled){
      if("boolean"!=typeof enabled){
        throw TypeError("Summary preference must be a boolean");
      }
      const record=loadRecord();
      const conversation=validateConversation(getConversation(record,sessionId));
      conversation.summaryEnabled=enabled;
      if(!enabled){
        delete conversation.summary;
      }
      saveConversation(record,sessionId,conversation);
    },
    setSummary(sessionId,summary){
      const record=loadRecord();
      const conversation=validateConversation(getConversation(record,sessionId));
      if(null===summary){
        delete conversation.summary;
      }else{
        conversation.summary=validateSummary(summary);
      }
      saveConversation(record,sessionId,conversation);
    },
    getConversation(sessionId){
      const record=loadRecord();
      const conversation=getConversation(record,sessionId);
      return{
        prompt:void 0!==conversation.prompt?conversation.prompt:record.legacyPrompt,
        summary:conversation.summary?{...validateSummary(conversation.summary)}:null,
        summaryEnabled:void 0!==conversation.summaryEnabled?conversation.summaryEnabled:true
      };
    }
  });
})();
