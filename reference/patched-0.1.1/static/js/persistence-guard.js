(()=>{
  "use strict";
  const databaseName="chat-demo";
  const activeWrites=new Set();
  const originalTransaction=IDBDatabase.prototype.transaction;
  const onBeforeUnload=event=>{
    if(activeWrites.size){
      event.preventDefault();
      event.returnValue="";
    }
  };

  IDBDatabase.prototype.transaction=function(...args){
    const transaction=Reflect.apply(originalTransaction,this,args);
    const mode="string"===typeof args[1]?args[1]:"readonly";
    if(this.name!==databaseName||"readwrite"!==mode){
      return transaction;
    }

    activeWrites.add(transaction);
    if(1===activeWrites.size){
      window.addEventListener("beforeunload",onBeforeUnload);
    }
    const finish=()=>{
      activeWrites.delete(transaction);
      if(!activeWrites.size){
        window.removeEventListener("beforeunload",onBeforeUnload);
      }
    };
    transaction.addEventListener("complete",finish,{once:true});
    transaction.addEventListener("abort",finish,{once:true});
    return transaction;
  };

  if(navigator.storage&&"function"===typeof navigator.storage.persist){
    navigator.storage.persist().catch(error=>{
      console.warn("[storage] Unable to request persistent local storage",error);
    });
  }
})();
