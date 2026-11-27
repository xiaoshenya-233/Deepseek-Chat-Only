'use strict'

/**
 * 本机 QA：驱动设置 →「数据管理」→ 上传 → 确认导入，采样进度条并截图。
 * 仅在 desktop/main.js 带 `--import-test <zip>` 时加载，不影响正式启动流程。
 *
 *   electron . --data-dir %TEMP%\qa-profile --import-test path\to\export.zip [--import-test-cancel]
 */

const { app } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 读 ZIP 中央目录里的条目名（按写入顺序），仅用于 QA 校验导出结构 */
const listZipEntries = (file) => {
  const buffer = fs.readFileSync(file)
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 66_000; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) {
    return []
  }
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const names = []
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      break
    }
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return names
}

const runImportTest = async (win, zipPath, options = {}) => {
  // setFileInputFiles 只接受绝对路径，允许文档里写相对路径（如 qa\fixtures\nav-test.zip）
  const archive = path.resolve(zipPath)
  const cancel = options.cancel === true
  const watchdog = setTimeout(() => {
    console.log('[import-test] TIMEOUT')
    app.exit(2)
    // 大归档（数百 MB）导入需要更久，可用 DSC_QA_TIMEOUT 放宽
  }, Number(process.env.DSC_QA_TIMEOUT || 90_000))
  const shot = async (name) => {
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(os.tmpdir(), name), image.toPNG())
  }
  const evaluate = (code) => win.webContents.executeJavaScript(code)

  try {
    await delay(1800)
    console.log(
      '[import-test] tab=' +
        (await evaluate(`(async () => {
          const findTab = () => [...document.querySelectorAll('[role="tab"]')]
            .find((t) => /数据管理|Data management/.test(t.textContent || ''));
          let tab = findTab();
          if (!tab) {
            const open = [...document.querySelectorAll('button')]
              .find((b) => /^\\s*设置\\s*$/.test(b.textContent || ''));
            open?.click();
            await new Promise((resolve) => setTimeout(resolve, 700));
            tab = findTab();
          }
          tab?.click();
          return !!tab;
        })()`))
    )
    await delay(600)
    win.webContents.debugger.attach('1.3')
    const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1 })
    const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type=file][accept*="zip"]',
    })
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
      files: [archive],
      nodeId,
    })
    await delay(500)
    console.log(
      '[import-test] confirm=' +
        (await evaluate(`(()=>{
          const b=[...document.querySelectorAll('button')].find(x=>/确认导入|^Import$/.test((x.textContent||'').trim()));
          b?.click(); return !!b})()`))
    )
    for (let index = 0; index < 14; index += 1) {
      await delay(400)
      const state = await evaluate(`(()=>{const bar=document.querySelector('[role="progressbar"]');
        const card=bar?.closest('div');
        return JSON.stringify({value:bar?.getAttribute('aria-valuenow')??null,text:(card?.parentElement?.innerText||'').replace(/\\n/g,' | ')})})()`)
      console.log('[import-test] ' + state)
      if (index === 1 && cancel) {
        console.log(
          '[import-test] cancel=' +
            (await evaluate(`(()=>{
              const b=[...document.querySelectorAll('button')].find(x=>/^\\s*取消\\s*$|^\\s*Cancel\\s*$/.test(x.textContent||''));
              b?.click(); return !!b})()`))
        )
      }
      if (index < 3) {
        await shot(`dsc-import-${index + 1}.png`)
      }
      if (!state.includes('value')) {
        break
      }
    }
    await delay(1200)
    console.log(
      '[import-test] status=' +
        (await evaluate(`(()=>{
          const text=[...document.querySelectorAll('div')].map(d=>d.textContent||'').find(t=>/已导入|已取消导入|Import/.test(t)&&t.length<80);
          return (text||'none').trim()})()`))
    )
    console.log(
      '[import-test] lazy=' +
        (await evaluate(`(()=>{const row=document.querySelector('[class*="column"] > *');
          return row?JSON.stringify({cv:getComputedStyle(row).contentVisibility, cis:getComputedStyle(row).containIntrinsicSize}):'no-rows'})()`))
    )
    if (options.checkViewer) {
      // 关掉导入完成后仍打开的设置弹窗，再打开会话里的图片
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(500)
      console.log(
        '[viewer-test] open-session=' +
          (await evaluate(`(()=>{
            const items=[...document.querySelectorAll('[title]')]
              .filter((el)=>el.closest('[class*="sider"], [class*="drawer"]') === null && el.tagName !== 'IMG');
            const target=document.querySelector('[title="图片预览测试"]')
              || document.querySelector('[class*="sessionItem"]')
              || document.querySelector('button[class*="item"]');
            target?.click(); return !!target})()`))
      )
      await delay(1500)
      console.log(
        '[viewer-test] click-image=' +
          (await evaluate(`(()=>{
            const b=document.querySelector('button[aria-label^="图片预览"]');
            b?.click(); return !!b})()`))
      )
      await delay(500)
      console.log(
        '[viewer-test] dialog=' +
          (await evaluate(`(()=>{const d=document.querySelector('[role="dialog"][aria-label="图片预览"]');
            if(!d) return 'none';
            const img=d.querySelector('img');
            return JSON.stringify({img:!!img,alt:img?.alt||'',w:img?.naturalWidth||0})})()`))
      )
      await shot('dsc-image-viewer.png')
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(300)
      console.log(
        '[viewer-test] closed=' +
          (await evaluate(`!document.querySelector('[role="dialog"][aria-label="图片预览"]')`))
      )
    }
    if (options.checkMenu) {
      // 关掉设置弹窗并打开会话，菜单与编辑按钮都在会话页里
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(400)
      console.log(
        '[menu-test] openSession=' +
          (await evaluate(`(()=>{
            const title=[...document.querySelectorAll('div')].find((el)=>el.textContent==='图片预览测试'&&el.children.length===0);
            const item=title?.parentElement;
            item?.click(); return !!item})()`))
      )
      await delay(1200)
      // 会话菜单：应该贴着 ⋯ 按钮出现，且行失去 hover 后不能跳到左上角
      console.log(
        '[menu-test] open=' +
          (await evaluate(`(()=>{
            const button=document.querySelector('[aria-label="更多"]');
            if(!button) return 'no-button';
            // 模拟 hover：让 ⋯ 按钮参与布局后再测量
            const action=button.closest('div'); if(action) action.style.display='flex';
            const before=button.getBoundingClientRect();
            button.click();
            window.__menuTestAnchor={left:before.left,right:before.right,bottom:before.bottom};
            return JSON.stringify({left:Math.round(before.left),bottom:Math.round(before.bottom)})})()`))
      )
      await delay(300)
      const readMenu = `(()=>{const menu=document.querySelector('[role="menu"]');
        if(!menu) return 'none';
        const r=menu.getBoundingClientRect();
        return JSON.stringify({left:Math.round(r.left),top:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)})})()`
      console.log('[menu-test] menu=' + (await evaluate(readMenu)))
      console.log(
        '[menu-test] anchorState=' +
          (await evaluate(`(()=>{const t=window.__menuTestAnchor;return JSON.stringify(t)})()`))
      )
      // 模拟鼠标离开会话行（.action 变 display:none），菜单不能移动
      await evaluate(`(()=>{const button=document.querySelector('[aria-label="更多"]');
        const action=button?.closest('div'); if(action) action.style.display='none'; return !!action})()`)
      await delay(300)
      console.log('[menu-test] afterHide=' + (await evaluate(readMenu)))
      await shot('dsc-session-menu.png')
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(200)
      // 编辑态附件：有图片附件时显示缩略图与删除按钮，点删除后消失
      console.log(
        '[edit-test] enter=' +
          (await evaluate(`(()=>{
            const edit=document.querySelector('[aria-label="编辑消息"]');
            edit?.click(); return !!edit})()`))
      )
      await delay(500)
      console.log(
        '[edit-test] chips=' +
          (await evaluate(`(()=>{
            const upload=document.querySelector('[aria-label="上传文件"]');
            const remove=document.querySelector('[aria-label="删除"]');
            return JSON.stringify({uploadButton:!!upload, removeButton:!!remove})})()`))
      )
      await shot('dsc-edit-attachments.png')
      await evaluate(`(()=>{const remove=document.querySelector('[aria-label="删除"]'); remove?.click(); return !!remove})()`)
      await delay(300)
      console.log(
        '[edit-test] afterRemove=' +
          (await evaluate(`JSON.stringify({removeButton:!!document.querySelector('[aria-label="删除"]')})`))
      )
    }
    if (options.checkPrompt) {
      // 打开设置（导入后可能已被关闭），再切到「通用设置」才能看到主题选项
      await evaluate(`(()=>{
        const open=[...document.querySelectorAll('button')].find((b)=>/^\\s*设置\\s*$|^\\s*Settings\\s*$/.test(b.textContent||''));
        open?.click(); return !!open})()`)
      await delay(500)
      await evaluate(`(()=>{
        const tab=[...document.querySelectorAll('[role="tab"]')].find((t)=>/通用设置|General/.test(t.textContent||''));
        tab?.click(); return !!tab})()`)
      await delay(400)
      console.log(
        '[theme-test] options=' +
          (await evaluate(`JSON.stringify([...document.querySelectorAll('[role="radio"]')].map((b)=>b.textContent.trim()))`))
      )
      console.log(
        '[theme-test] select=' +
          (await evaluate(`(()=>{
            const button=[...document.querySelectorAll('[role="radio"]')].find((b)=>/日出日落|Sunrise/.test(b.textContent||''));
            button?.click();
            return JSON.stringify({clicked:!!button, saved:localStorage.getItem('chat-demo:theme-preference'),
              dark:document.body.classList.contains('dark')})})()`))
      )
      // 关掉设置弹窗并打开会话，再测会话提示词
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(300)
      await evaluate(`(()=>{
        const title=[...document.querySelectorAll('div')].find((el)=>el.textContent==='图片预览测试'&&el.children.length===0);
        title?.parentElement?.click(); return !!title})()`)
      await delay(1000)
      console.log(
        '[prompt-test] open=' +
          (await evaluate(`(()=>{const b=document.querySelector('[aria-label^="对话提示词"]'); b?.click(); return !!b})()`))
      )
      await delay(400)
      console.log(
        '[prompt-test] save=' +
          (await evaluate(`(()=>{
            const dialog=[...document.querySelectorAll('[role="dialog"]')].find((d)=>/对话提示词/.test(d.textContent||''));
            const area=dialog?.querySelector('textarea');
            if(!area) return 'no-textarea';
            const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
            setter.call(area,'你是一位严谨的电路设计顾问，先给结论再说明依据。');
            area.dispatchEvent(new Event('input',{bubbles:true}));
            const save=[...dialog.querySelectorAll('button')].find((b)=>b.textContent.trim()==='保存'||b.textContent.trim()==='Save');
            save?.click();
            return !!save})()`))
      )
      await delay(400)
      console.log(
        '[prompt-test] stored=' +
          (await evaluate(`(()=>{
            const raw=localStorage.getItem('chat-demo:session-prompts')||'{}';
            const stored=Object.values(JSON.parse(raw))[0]||'';
            const active=!!document.querySelector('[aria-label="对话提示词（已设置）"]');
            return JSON.stringify({hasText:stored.startsWith('你是一位严谨的电路设计顾问'), active})})()`))
      )
      console.log(
        '[prompt-test] reopen=' +
          (await evaluate(`(()=>{const b=document.querySelector('[aria-label^="对话提示词"]'); b?.click(); return !!b})()`))
      )
      await delay(400)
      console.log(
        '[prompt-test] reopenedValue=' +
          (await evaluate(`(()=>{const area=document.querySelector('[role="dialog"] textarea');
            return JSON.stringify({value:(area?.value||'').slice(0,14)})})()`))
      )
      await shot('dsc-session-prompt.png')
    }
    if (options.checkUi) {
      // 打开测试会话（30 条消息，最后一条含 Mermaid）
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(300)
      console.log(
        '[ui-test] openSession=' +
          (await evaluate(`(()=>{
            const title=[...document.querySelectorAll('div')].find((el)=>el.textContent==='分页与脑图测试'&&el.children.length===0);
            title?.parentElement?.click(); return !!title})()`))
      )
      await delay(1200)

      const countRows = `(()=>{const column=document.querySelector('[class*="column"]');return column?column.children.length:-1})()`
      // ① 首屏只挂载 10 条
      console.log('[ui-test] rowsInitial=' + (await evaluate(countRows)))
      // ② 滚到顶部触发加载更早的一页
      const scrollToTop = `(()=>{const column=document.querySelector('[class*="column"]');
        let el=column?.parentElement;
        while(el&&el!==document.body&&getComputedStyle(el).overflowY!=='auto'){el=el.parentElement}
        if(!el) return 'no-scroller';
        el.scrollTop=0; el.dispatchEvent(new Event('scroll')); return 'ok'})()`
      console.log('[ui-test] scrollTop1=' + (await evaluate(scrollToTop)))
      await delay(600)
      console.log('[ui-test] rowsAfter1=' + (await evaluate(countRows)))
      console.log('[ui-test] scrollTop2=' + (await evaluate(scrollToTop)))
      await delay(600)
      console.log('[ui-test] rowsAfter2=' + (await evaluate(countRows)))
      await shot('dsc-paging.png')

      // ③ 脑图：点开放大预览，保存 PNG
      console.log(
        '[ui-test] mermaid=' +
          (await evaluate(`(()=>{const diagram=document.querySelector('.md-mermaid-diagram');
            diagram?.click(); return !!diagram})()`))
      )
      await delay(600)
      console.log(
        '[ui-test] preview=' +
          (await evaluate(`(()=>{const dialog=document.querySelector('[role="dialog"][aria-label="放大脑图"]');
            return JSON.stringify({open:!!dialog, svg:!!dialog?.querySelector('svg')})})()`))
      )
      await shot('dsc-mermaid-preview.png')
      const saveProbe = `(async () => {
        const original = HTMLAnchorElement.prototype.click;
        let captured = null;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download) { captured = { name: this.download, href: this.href }; return; }
          return original.call(this);
        };
        const button = [...document.querySelectorAll('button')].find((b) => /保存图片|Save image/.test(b.textContent || ''));
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 900));
        let info = {};
        if (captured) {
          const buffer = new Uint8Array(await (await fetch(captured.href)).arrayBuffer());
          info = {
            size: buffer.length,
            png: buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47,
          };
          try {
            const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/png' }));
            info.w = bitmap.width;
            info.h = bitmap.height;
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d');
            context.drawImage(bitmap, 0, 0);
            const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
            let painted = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) { painted += 1; }
            }
            info.paintedPixels = painted;
          } catch (error) { info.decodeError = String(error && error.message); }
        }
        HTMLAnchorElement.prototype.click = original;
        return JSON.stringify({ clicked: !!button, name: captured ? captured.name : null, ...info });
      })()`
      console.log('[ui-test] save=' + (await evaluate(saveProbe)))
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(300)
      console.log(
        '[ui-test] closed=' +
          (await evaluate(`!document.querySelector('[role="dialog"][aria-label="放大脑图"]')`))
      )

      // ④ 提示词统一管理
      await evaluate(`(()=>{
        const open=[...document.querySelectorAll('button')].find((b)=>/^\\s*设置\\s*$/.test(b.textContent||''));
        open?.click(); return !!open})()`)
      await delay(500)
      await evaluate(`(()=>{
        const tab=[...document.querySelectorAll('[role="tab"]')].find((t)=>/数据管理|Data management/.test(t.textContent||''));
        tab?.click(); return !!tab})()`)
      await delay(400)
      await evaluate(`(()=>{
        const button=[...document.querySelectorAll('button')].find((b)=>/^\\s*管理\\s*$/.test(b.textContent||''));
        button?.click(); return !!button})()`)
      await delay(600)
      console.log(
        '[ui-test] manager=' +
          (await evaluate(`(()=>{const dialogs=[...document.querySelectorAll('[role="dialog"]')]
            .filter((d)=>/对话管理|Chat manager/.test(d.textContent||''));
            const dialog=dialogs.find((d)=>d.querySelector('li'))||dialogs[dialogs.length-1];
            const rows=dialog?dialog.querySelectorAll('li').length:-1;
            const edits=dialog?[...dialog.querySelectorAll('button')].filter((b)=>/编辑|Edit/.test(b.textContent||'')).length:-1;
            return JSON.stringify({open:!!dialog, dialogs:dialogs.length, rows, editButtons:edits})})()`))
      )
      await shot('dsc-prompt-manager.png')
    }
    if (options.checkNav) {
      // 关掉导入完成后的设置弹窗，打开导航测试会话（12 轮 Q&A，回答都带思考）
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(400)
      console.log(
        '[nav-test] openSession=' +
          (await evaluate(`(()=>{
            const title=[...document.querySelectorAll('div')].find((el)=>el.textContent==='导航测试会话'&&el.children.length===0);
            title?.parentElement?.click(); return !!title})()`))
      )
      await delay(1500)

      // 消息列表的滚动容器：桌面端是 .container，移动端是 .scroll
      const getScroller = `(()=>{
        const column=document.querySelector('[class*="column"]');
        let el=column?column.parentElement:null;
        while(el&&el!==document.body&&getComputedStyle(el).overflowY!=='auto'){el=el.parentElement}
        return el&&el!==document.body?el:document.querySelector('[class*="scroll"]')})()`
      const readState = `(()=>{
        const el=${getScroller};
        const button=document.querySelector('[aria-label="回到底部"]');
        return JSON.stringify({
          scrollTop:el?Math.round(el.scrollTop):-1,
          distance:el?Math.round(el.scrollHeight-el.scrollTop-el.clientHeight):-1,
          jump:!!button,
          think:document.querySelectorAll('.ds-think-content').length})})()`

      console.log('[nav-test] initial=' + (await evaluate(readState)))

      // ① 上滑离开底部：出现「回到底部」
      await evaluate(`(()=>{const el=${getScroller}; if(!el) return false; el.scrollTop=0;
        el.dispatchEvent(new Event('scroll')); return true})()`)
      await delay(600)
      console.log('[nav-test] afterScrollUp=' + (await evaluate(readState)))
      console.log(
        '[nav-test] jumpPlacement=' +
          (await evaluate(`(()=>{
            const jump=document.querySelector('[aria-label="回到底部"]');
            const composer=document.querySelector('[class*="inputContainer"]');
            if(!jump||!composer) return 'none';
            const j=jump.getBoundingClientRect();
            const c=composer.getBoundingClientRect();
            const area=jump.offsetParent?jump.offsetParent.getBoundingClientRect():null;
            return JSON.stringify({
              gapAboveComposer:Math.round(c.top-j.bottom),
              centerDelta:area?Math.round(j.left+j.width/2-(area.left+area.width/2)):null})})()`))
      )
      await shot('dsc-jump-to-bottom.png')

      // ② 点击「回到底部」：回到最新一条，按钮消失
      console.log(
        '[nav-test] clickJump=' +
          (await evaluate(
            `(()=>{const b=document.querySelector('[aria-label="回到底部"]'); b?.click(); return !!b})()`
          ))
      )
      await delay(1400)
      console.log('[nav-test] afterJump=' + (await evaluate(readState)))
      await shot('dsc-after-jump.png')

      // ③ 对话总览：列出全部提问
      console.log(
        '[nav-test] outlineOpen=' +
          (await evaluate(
            `(()=>{const b=document.querySelector('[aria-label="对话总览"]'); b?.click(); return !!b})()`
          ))
      )
      await delay(500)
      console.log(
        '[nav-test] outlinePanel=' +
          (await evaluate(`(()=>{
            const panel=[...document.querySelectorAll('[role="menu"]')].find((m)=>/个提问/.test(m.textContent||''));
            if(!panel) return 'none';
            const items=[...panel.querySelectorAll('[role="menuitem"]')];
            return JSON.stringify({items:items.length, first:(items[0]?.textContent||'').trim().slice(0,26),
              head:(panel.firstElementChild?.textContent||'').trim()})})()`))
      )
      await shot('dsc-session-outline.png')

      // ④ 点第 2 条提问：向上滚动到该消息并高亮
      console.log(
        '[nav-test] outlineJump=' +
          (await evaluate(`(()=>{
            const el=${getScroller};
            const panel=[...document.querySelectorAll('[role="menu"]')].find((m)=>/个提问/.test(m.textContent||''));
            const items=panel?[...panel.querySelectorAll('[role="menuitem"]')]:[];
            window.__navBefore=el?el.scrollTop:0;
            window.__navLong=[];
            try { window.__navObserver && window.__navObserver.disconnect(); } catch {}
            window.__navObserver = new PerformanceObserver((list)=>{
              for(const entry of list.getEntries()){ if(!entry.hadRecentInput) window.__navLong.push(Math.round(entry.duration)) }
            });
            try { window.__navObserver.observe({entryTypes:['longtask']}) } catch {}
            window.__navClickAt=performance.now();
            items[1]?.click(); return items.length>=2})()`))
      )
      await delay(800)
      console.log(
        '[nav-test] afterOutlineJump=' +
          (await evaluate(`(()=>{
            const el=${getScroller};
            const marked=document.querySelector('[data-dsc-jump="1"]');
            return JSON.stringify({
              before:Math.round(window.__navBefore||0),
              after:el?Math.round(el.scrollTop):-1,
              movedBack:!!el&&el.scrollTop<(window.__navBefore||0),
              highlight:!!marked,
              targetTop:marked&&el?Math.round(marked.getBoundingClientRect().top-el.getBoundingClientRect().top):null})})()`))
      )
      await shot('dsc-outline-jump.png')
      console.log(
        '[nav-test] jumpCost=' +
          (await evaluate(`(()=>{
            const column=document.querySelector('[class*="column"]');
            return JSON.stringify({
              rows:column?column.children.length:-1,
              longTasks:(window.__navLong||[]).sort((a,b)=>b-a).slice(0,3),
              clickToNow:Math.round(performance.now()-(window.__navClickAt||0))})})()`))
      )
      // 跳到中间后继续往下滚：窗口应自动补页，而不是停在半截
      const readExtend = `(()=>{
        const column=document.querySelector('[class*="column"]');
        const el=${getScroller};
        return JSON.stringify({rows:column?column.children.length:-1,
          distance:el?Math.round(el.scrollHeight-el.scrollTop-el.clientHeight):-1})})()`
      for (let round = 1; round <= 6; round += 1) {
        await evaluate(
          `(()=>{const el=${getScroller}; el.scrollTop=el.scrollHeight; el.dispatchEvent(new Event('scroll')); return true})()`
        )
        await delay(320)
        console.log('[nav-test] extendDown' + round + '=' + (await evaluate(readExtend)))
      }

      // ⑤ 折叠思考（设置页开关）：收起后思考正文消失，再关一次恢复
      console.log(
        '[nav-test] openSettings=' +
          (await evaluate(`(()=>{
            const open=[...document.querySelectorAll('button')].find((b)=>/^\\s*设置\\s*$|^\\s*Settings\\s*$/.test(b.textContent||''));
            open?.click(); return !!open})()`))
      )
      await delay(600)
      console.log(
        '[nav-test] generalTab=' +
          (await evaluate(`(()=>{
            const tab=[...document.querySelectorAll('[role="tab"]')].find((x)=>/通用设置|General/.test(x.textContent||''));
            tab?.click(); return !!tab})()`))
      )
      await delay(400)
      console.log(
        '[nav-test] collapseSwitch=' +
          (await evaluate(`(()=>{
            const sw=document.querySelector('[role="switch"][aria-label="折叠思考过程"]');
            if(!sw) return 'none';
            sw.click();
            return JSON.stringify({on:sw.getAttribute('aria-checked'), stored:localStorage.getItem('chat-demo:collapse-thinking')})})()`))
      )
      await delay(500)
      await shot('dsc-thinking-setting.png')
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(500)
      console.log('[nav-test] collapsed=' + (await evaluate(readState)))
      await shot('dsc-think-collapsed.png')
      console.log(
        '[nav-test] reopenSettings=' +
          (await evaluate(`(()=>{
            const open=[...document.querySelectorAll('button')].find((b)=>/^\\s*设置\\s*$|^\\s*Settings\\s*$/.test(b.textContent||''));
            open?.click(); return !!open})()`))
      )
      await delay(600)
      await evaluate(`(()=>{
        const tab=[...document.querySelectorAll('[role="tab"]')].find((x)=>/通用设置|General/.test(x.textContent||''));
        tab?.click(); return !!tab})()`)
      await delay(400)
      console.log(
        '[nav-test] expandSwitch=' +
          (await evaluate(`(()=>{
            const sw=document.querySelector('[role="switch"][aria-label="折叠思考过程"]');
            sw?.click(); return !!sw})()`))
      )
      await delay(400)
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(500)
      console.log('[nav-test] expanded=' + (await evaluate(readState)))
      await shot('dsc-think-expanded.png')

      // ⑥ 移动端：总览变成输入框上方靠右的悬浮球，「回到底部」保持水平居中
      win.setContentSize(390, 844)
      await delay(1000)
      console.log(
        '[nav-test] mobileBall=' +
          (await evaluate(`(()=>{
            const ball=[...document.querySelectorAll('button')].find((b)=>b.getAttribute('aria-label')==='对话总览');
            const r=ball?ball.getBoundingClientRect():null;
            return JSON.stringify({
              ball:!!ball,
              right:r?Math.round(window.innerWidth-r.right):null,
              gapAboveComposer:r?Math.round((()=>{const c=document.querySelector('[class*="inputContainer"]');
                return c?c.getBoundingClientRect().top-r.bottom:0})()):null,
              size:r?[Math.round(r.width),Math.round(r.height)]:null,
              headerButton:!!document.querySelector('[class*="header"] [aria-label="对话总览"]')})})()`))
      )
      await evaluate(
        `(()=>{const b=[...document.querySelectorAll('button')].find((x)=>x.getAttribute('aria-label')==='对话总览');
          b?.click(); return !!b})()`
      )
      await delay(500)
      console.log(
        '[nav-test] mobilePanel=' +
          (await evaluate(`(()=>{
            const panel=[...document.querySelectorAll('[role="menu"]')].find((m)=>/个提问/.test(m.textContent||''));
            if(!panel) return 'none';
            const r=panel.getBoundingClientRect();
            return JSON.stringify({items:panel.querySelectorAll('[role="menuitem"]').length,
              aboveBall:r.bottom<window.innerHeight-100})})()`))
      )
      await shot('dsc-outline-mobile.png')
      console.log('[nav-test] DONE')
    }
    if (options.checkManage) {
      // 收尾前面可能留下的弹窗（设置、对话管理等），最多按 3 次 Esc
      for (let index = 0; index < 3; index += 1) {
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
        await delay(250)
      }
      const openSettings = `(()=>{const b=[...document.querySelectorAll('button')].find((x)=>/^\\s*设置\\s*$/.test(x.textContent||'')); b?.click(); return !!b})()`
      const openData = `(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find((t)=>/数据管理|Data management/.test(t.textContent||'')); tab?.click(); return !!tab})()`
      const findDialog = (pattern) =>
        `[...document.querySelectorAll('[role="dialog"]')].find((d)=>/` + pattern + `/.test(d.textContent||''))`
      /** 命中有复选框的那个弹窗（设置弹窗的文案里也有同样的标题） */
      const pickListDialog = (pattern) => `(()=>{const list=[...document.querySelectorAll('[role="dialog"]')]
        .filter((d)=>/` + pattern + `/.test(d.textContent||''));
        return list.find((d)=>d.querySelector('input[type=checkbox]'))||list[list.length-1]})()`

      // ① 置顶会话：⋯ → 置顶会话
      console.log(
        '[manage-test] menu=' +
          (await evaluate(`(()=>{const b=document.querySelector('button[aria-label="更多"]'); b?.click(); return !!b})()`))
      )
      await delay(400)
      console.log(
        '[manage-test] pinClick=' +
          (await evaluate(`(()=>{const option=[...document.querySelectorAll('[role="menuitem"]')]
            .find((el)=>/置顶会话|Pin chat/.test(el.textContent||'')); option?.click(); return !!option})()`))
      )
      await delay(600)
      console.log(
        '[manage-test] pinned=' +
          (await evaluate(`(()=>{const headers=[...document.querySelectorAll('[class*="sectionHeader"]')]
            .map((el)=>(el.textContent||'').trim());
            return JSON.stringify({headers:headers.slice(0,3), stored:localStorage.getItem('chat-demo:pinned-sessions')})})()`))
      )
      await shot('dsc-pin.png')

      // ② 自由选择导出
      await evaluate(openSettings)
      await delay(500)
      await evaluate(openData)
      await delay(400)
      console.log(
        '[manage-test] openExport=' +
          (await evaluate(`(()=>{const b=[...document.querySelectorAll('button')]
            .find((x)=>/^\\s*选择\\s*$/.test(x.textContent||'')); b?.click(); return !!b})()`))
      )
      await delay(600)
      const exportDialog = pickListDialog('导出历史对话')
      console.log(
        '[manage-test] exportDialog=' +
          (await evaluate(`(()=>{const dialog=${exportDialog};
            const checks=dialog?[...dialog.querySelectorAll('input[type=checkbox]')]:[];
            return JSON.stringify({open:!!dialog, rows:checks.length, checked:checks.filter((c)=>c.checked).length})})()`))
      )
      await shot('dsc-export-select.png')
      const exportProbe = `(async () => {
        const dialog = ${exportDialog};
        dialog?.querySelector('input[type=checkbox]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const original = HTMLAnchorElement.prototype.click;
        let captured = null;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download) { captured = { name: this.download, href: this.href }; return; }
          return original.call(this);
        };
        const button = [...(dialog?.querySelectorAll('button') || [])]
          .find((b) => /导出所选|Export selected/.test(b.textContent || ''));
        const checked = [...(dialog?.querySelectorAll('input[type=checkbox]') || [])]
          .filter((c) => c.checked).length;
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 1800));
        HTMLAnchorElement.prototype.click = original;
        let size = 0;
        if (captured) { size = (await (await fetch(captured.href)).arrayBuffer()).byteLength; }
        return JSON.stringify({ clicked: !!button, checked, name: captured ? captured.name : null, size });
      })()`
      console.log('[manage-test] export=' + (await evaluate(exportProbe)))
      await delay(800)
      // 导出成功后弹窗自行关闭，回到设置列表
      console.log(
        '[manage-test] exportClosed=' +
          (await evaluate(`(()=>[...document.querySelectorAll('[role="dialog"]')]
            .filter((d)=>/导出历史对话|Export chats/.test(d.textContent||'') && d.querySelector('input[type=checkbox]')).length===0)()`))
      )
      console.log(
        '[manage-test] dialogsAfterExport=' +
          (await evaluate(`JSON.stringify([...document.querySelectorAll('[role="dialog"]')].map((d)=>(d.textContent||'').slice(0,12)))`))
      )
      // 设置弹窗可能在导出后关闭，按需重新打开到「数据管理」
      const hasSettings = `!![...document.querySelectorAll('[role="tab"]')].find((t)=>/数据管理|Data management/.test(t.textContent||''))`
      if (!(await evaluate(hasSettings))) {
        await evaluate(openSettings)
        await delay(600)
        await evaluate(openData)
        await delay(400)
      }

      // ③ 对话管理：提示词导入导出 + 批量删除
      const manageDialog = `(()=>{const list=[...document.querySelectorAll('[role="dialog"]')]
        .filter((d)=>/对话管理|Chat manager/.test(d.textContent||''));
        const dialog=list.find((d)=>d.querySelector('input[type=checkbox]'))||list[list.length-1];
        return dialog})()`
      console.log(
        '[manage-test] manager=' +
          (await evaluate(`(()=>{const list=[...document.querySelectorAll('button')]
            .filter((x)=>/^\\s*管理\\s*$/.test(x.textContent||''));
            const b=list[0]; b?.click();
            return JSON.stringify({found:list.length, disabled:b?b.disabled:null})})()`))
      )
      await delay(600)
      console.log(
        '[manage-test] managerDialog=' +
          (await evaluate(`(()=>{const dialog=${manageDialog};
            const checks=dialog?[...dialog.querySelectorAll('input[type=checkbox]')]:[];
            const tools=dialog?[...dialog.querySelectorAll('button')]
              .filter((b)=>/导出提示词|导入提示词/.test(b.textContent||'')).length:-1;
            return JSON.stringify({open:!!dialog, rows:checks.length, promptTools:tools})})()`))
      )
      await shot('dsc-manage.png')
      const countBefore = await evaluate(
        `(()=>{const dialog=${manageDialog}; return dialog?dialog.querySelectorAll('input[type=checkbox]').length:-1})()`
      )
      console.log(
        '[manage-test] selectOne=' +
          (await evaluate(`(()=>{const dialog=${manageDialog};
            const box=dialog?.querySelector('input[type=checkbox]'); box?.click(); return !!box})()`))
      )
      await delay(300)
      console.log(
        '[manage-test] deleteOpen=' +
          (await evaluate(`(()=>{const dialog=${manageDialog};
            if(!dialog) return false;
            const button=[...dialog.querySelectorAll('button')].find((b)=>/删除所选|Delete selected/.test(b.textContent||''));
            button?.click(); return !!button})()`))
      )
      await delay(400)
      console.log(
        '[manage-test] confirm=' +
          (await evaluate(`(()=>{const dialogs=[...document.querySelectorAll('[role="dialog"]')];
            const dialog=dialogs[dialogs.length-1];
            if(!dialog) return false;
            const button=[...dialog.querySelectorAll('button')].find((b)=>/删除所选|Delete selected/.test(b.textContent||''));
            button?.click(); return !!button})()`))
      )
      await delay(1600)
      console.log(
        '[manage-test] deleted=' +
          (await evaluate(`(()=>{const dialog=${manageDialog};
            const after=dialog?dialog.querySelectorAll('input[type=checkbox]').length:-1;
            const toast=[...document.querySelectorAll('div')].map((d)=>d.textContent||'')
              .find((t)=>/已删除|Deleted \\d/.test(t)&&t.length<40);
            return JSON.stringify({before:${countBefore}, after, toast:(toast||'').trim()})})()`))
      )
      await shot('dsc-manage-deleted.png')
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(250)
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(300)

      // ④ 移动端：弹窗全屏（侧边栏收在抽屉里，先打开抽屉再点设置）
      win.setContentSize(420, 840)
      await delay(900)
      console.log(
        '[manage-test] drawer=' +
          (await evaluate(`(()=>{const b=document.querySelector('button[aria-label="打开边栏"],button[aria-label="Open sidebar"]'); b?.click(); return !!b})()`))
      )
      await delay(600)
      await evaluate(openSettings)
      await delay(800)
      console.log(
        '[manage-test] mobile=' +
          (await evaluate(`(()=>{const dialog=document.querySelector('[role="dialog"]');
            const box=dialog?.getBoundingClientRect();
            return JSON.stringify({w:Math.round(box?.width||0), h:Math.round(box?.height||0),
              vw:window.innerWidth, vh:window.innerHeight,
              radius:dialog?getComputedStyle(dialog).borderTopLeftRadius:null})})()`))
      )
      await shot('dsc-mobile-modal.png')
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
      await delay(300)
      win.setContentSize(1460, 940)
      await delay(500)
    }
    if (options.checkPolish) {
      for (let index = 0; index < 6; index += 1) {
        const open = await evaluate(`document.querySelectorAll('[role="dialog"]').length`)
        if (open === 0) {
          break
        }
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
        await delay(220)
      }
      await evaluate(`(()=>{
        const title=[...document.querySelectorAll('div')].find((el)=>el.textContent==='分页与脑图测试'&&el.children.length===0);
        title?.parentElement?.click(); return !!title})()`)
      await delay(1200)
      await evaluate(`document.querySelector('.md-mermaid-diagram')?.click(),null`)
      await delay(800)
      const readView = `(()=>{const inner=document.querySelector('[role="dialog"][aria-label="放大脑图"] [class*="inner"]');
        if(!inner) return 'no-inner';
        const stage=inner.closest('[role="dialog"]');
        return JSON.stringify({transform:inner.style.transform, userSelect:getComputedStyle(inner).userSelect, cursor:getComputedStyle(stage).cursor})})()`
      console.log('[polish-test] initial=' + (await evaluate(readView)))
      console.log(
        '[polish-test] wheel=' +
          (await evaluate(`(()=>{const stage=document.querySelector('[role="dialog"][aria-label="放大脑图"]');
            const rect=stage.getBoundingClientRect();
            stage.dispatchEvent(new WheelEvent('wheel',{deltaY:-240,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,bubbles:true,cancelable:true}));
            return 'ok'})()`))
      )
      await delay(400)
      console.log('[polish-test] afterWheel=' + (await evaluate(readView)))
      console.log(
        '[polish-test] drag=' +
          (await evaluate(`(()=>{const stage=document.querySelector('[role="dialog"][aria-label="放大脑图"]');
            const rect=stage.getBoundingClientRect();
            const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
            const event=(type,x,y)=>new PointerEvent(type,{pointerId:1,pointerType:'mouse',button:0,buttons:1,clientX:x,clientY:y,bubbles:true,cancelable:true});
            stage.dispatchEvent(event('pointerdown',cx,cy));
            stage.dispatchEvent(event('pointermove',cx+90,cy+60));
            window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,pointerType:'mouse',bubbles:true}));
            return 'ok'})()`))
      )
      await delay(400)
      console.log('[polish-test] afterDrag=' + (await evaluate(readView)))
      console.log(
        '[polish-test] selection=' +
          (await evaluate(`(()=>{const inner=document.querySelector('[role="dialog"][aria-label="放大脑图"] [class*="inner"]');
            if(!inner) return 'no-inner';
            const range=document.createRange(); range.selectNodeContents(inner); const sel=getSelection();
            sel.removeAllRanges(); sel.addRange(range);
            const text=String(sel.toString()).length; sel.removeAllRanges(); return text})()`))
      )
      await shot('dsc-mermaid-pan.png')
      console.log('[polish-test] backModal=' + (await evaluate(`String(window.__dscHandleBack())`)))
      await delay(350)
      console.log(
        '[polish-test] backModalState=' +
          (await evaluate(`JSON.stringify({preview:!!document.querySelector('[role="dialog"][aria-label="放大脑图"]')})`))
      )
      console.log('[polish-test] backSession=' + (await evaluate(`String(window.__dscHandleBack())`)))
      await delay(450)
      console.log(
        '[polish-test] backSessionState=' +
          (await evaluate(`JSON.stringify({welcome:!!document.querySelector('[class*="greeting"]')})`))
      )
      console.log('[polish-test] backIdle=' + (await evaluate(`String(window.__dscHandleBack())`)))
      await shot('dsc-back.png')
    }
    if (options.checkCompress) {
      let original = 0
      try {
        original = JSON.parse(fs.readFileSync(zipPath.replace(/\.zip$/, '.json'), 'utf8')).originalSize
      } catch {
        original = 0
      }
      const readFiles = `(async () => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('chat-demo');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const files = await new Promise((resolve, reject) => {
          const tx = db.transaction('files', 'readonly');
          const req = tx.objectStore('files').getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return JSON.stringify(files.map((file) => ({ id: file.id, size: file.blob.size, type: file.blob.type })));
      })()`
      console.log('[compress-test] imported=' + (await evaluate(readFiles)))
      console.log('[compress-test] originalSize=' + original)
      await shot('dsc-compress-imported.png')

      // 选图路径：先写入 API Key 并重载，再拦截 createObjectURL 采样草稿图片体积
      await evaluate(`localStorage.setItem('chat-demo:api-key','sk-test'),null`)
      win.webContents.reload()
      await delay(2600)
      await evaluate(`(()=>{
        const sizes=[];
        const original=URL.createObjectURL.bind(URL);
        URL.createObjectURL=(value)=>{
          if(value instanceof Blob && (value.type||'').startsWith('image/')) sizes.push({size:value.size,type:value.type});
          return original(value)};
        window.__pickedSizes=sizes; return true})()`)
      try {
        win.webContents.debugger.attach('1.3')
      } catch {
        // 前面的导入步骤已经挂上了调试器，直接复用
      }
      const doc = await win.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1 })
      const fileNode = await win.webContents.debugger.sendCommand('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: 'input[type=file][accept*=".png"]',
      })
      await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
        files: [zipPath.replace(/\.zip$/, '.png')],
        nodeId: fileNode.nodeId,
      })
      await delay(4500)
      console.log(
        '[compress-test] picked=' + (await evaluate(`JSON.stringify(window.__pickedSizes || [])`))
      )
      console.log(
        '[compress-test] draftCards=' +
          (await evaluate(`document.querySelectorAll('[class*="attachment"]').length`))
      )
      await shot('dsc-compress-picked.png')
    }
    if (options.checkUrlImport) {
      const LINK =
        'https://deepseek-chat-history-exports-prod.obs.cn-east-3.myhuaweicloud.com/55f07e3c-6889-48f3-8cb9-3f2efd4d071e.zip?response-content-disposition=attachment%3B%20filename%3Ddeepseek_data-2026-11-21.zip&Expires=1795872324&AccessKeyId=OD83TSXECLFQNNSZ3IF6&Signature=PfhpSQXMoLAe5D%2BsRBTBZ90Lq1I%3D'
      for (let index = 0; index < 4; index += 1) {
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
        await delay(220)
      }
      await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find((x)=>/^\\s*设置\\s*$/.test(x.textContent||'')); b?.click(); return !!b})()`)
      await delay(500)
      await evaluate(`(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find((t)=>/数据管理|Data management/.test(t.textContent||'')); tab?.click(); return !!tab})()`)
      await delay(400)
      console.log(
        '[url-test] open=' +
          (await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find((x)=>/粘贴链接|Paste link/.test(x.textContent||'')); b?.click(); return !!b})()`))
      )
      await delay(600)
      await shot('dsc-url-dialog.png')
      console.log(
        '[url-test] dialog=' +
          (await evaluate(`(()=>{const d=[...document.querySelectorAll('[role="dialog"]')].find((x)=>/从链接导入|Import chats from link/.test(x.textContent||'')); return JSON.stringify({open:!!d, hint:(d?.textContent||'').includes('发放的下载链接')||(d?.textContent||'').includes('DeepSeek issued')})})()`))
      )
      console.log(
        '[url-test] fill=' +
          (await evaluate(`(()=>{const input=document.querySelector('[role="dialog"] input[type="url"]');
            if(!input) return false;
            const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
            setter.call(input, ${JSON.stringify('LINK_PLACEHOLDER')});
            input.dispatchEvent(new Event('input',{bubbles:true}));
            return true})()`.replace('LINK_PLACEHOLDER', LINK.replace(/'/g, "\\'"))))
      )
      await delay(300)
      console.log(
        '[url-test] submit=' +
          (await evaluate(`(()=>{const b=[...document.querySelectorAll('[role="dialog"] button')].find((x)=>/下载并导入|Download and import/.test(x.textContent||'')); b?.click(); return !!b})()`))
      )
      let confirmed = false
      for (let index = 0; index < 24; index += 1) {
        await delay(500)
        const state = await evaluate(
          `JSON.stringify({progress:!!document.querySelector('[role="progressbar"]'), confirm:!![...document.querySelectorAll('[role="dialog"]')].find((d)=>/确认导入历史对话|Import chat history/.test(d.textContent||''))})`
        )
        console.log('[url-test] state=' + state)
        if (state.includes('"confirm":true')) {
          confirmed = true
          break
        }
      }
      await shot('dsc-url-import.png')
      if (confirmed) {
        console.log(
          '[url-test] confirm=' +
            (await evaluate(`(()=>{const d=[...document.querySelectorAll('[role="dialog"]')].reverse().find((x)=>/确认导入历史对话|Import chat history/.test(x.textContent||''));
              const b=[...d.querySelectorAll('button')].find((x)=>/确认导入|^\\s*Import\\s*$/.test(x.textContent||'')); b?.click(); return !!b})()`))
        )
        await delay(4000)
        console.log(
          '[url-test] status=' +
            (await evaluate(`(()=>{const text=[...document.querySelectorAll('div')].map((d)=>d.textContent||'').find((t)=>/已导入|已取消导入|Imported/.test(t)&&t.length<60); return (text||'none').trim()})()`))
        )
      }
      await shot('dsc-url-import-done.png')
    }
    if (options.checkPanels) {
      for (let index = 0; index < 4; index += 1) {
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
        await delay(220)
      }
      // 附件按钮需要已配置 API Key，否则会先弹设置
      await evaluate(`localStorage.setItem('chat-demo:api-key','sk-test'),null`)
      win.webContents.reload()
      await delay(2600)
      // 附件面板：三个类别
      console.log(
        '[panel-test] attach=' +
          (await evaluate(`(()=>{const b=document.querySelector('button[aria-label="添加附件"]'); b?.click(); return !!b})()`))
      )
      await delay(500)
      console.log(
        '[panel-test] options=' +
          (await evaluate(`JSON.stringify([...document.querySelectorAll('[data-attach-menu] button')].map((b)=>(b.textContent||'').trim()))`))
      )
      console.log(
        '[panel-test] sizes=' +
          (await evaluate(`(()=>{const panel=document.querySelector('[data-attach-menu]');
            const card=panel?.previousElementSibling;
            const widths=[...(panel?.querySelectorAll('button')||[])].map((b)=>Math.round(b.getBoundingClientRect().width));
            return JSON.stringify({viewport:window.innerWidth, panel:Math.round(panel?.getBoundingClientRect().width||0), composer:Math.round(card?.getBoundingClientRect().width||0), widths})})()`))
      )
      await shot('dsc-attach-panel.png')
      // 窄屏自适应
      win.setContentSize(390, 844)
      await delay(900)
      await evaluate(`(()=>{if(!document.querySelector('[data-attach-menu]')) document.querySelector('button[aria-label="添加附件"]')?.click(),null})()`)
      await delay(400)
      console.log(
        '[panel-test] narrow=' +
          (await evaluate(`(()=>{const panel=document.querySelector('[data-attach-menu]');
            const card=panel?.previousElementSibling;
            const widths=[...(panel?.querySelectorAll('button')||[])].map((b)=>Math.round(b.getBoundingClientRect().width));
            const heights=[...(panel?.querySelectorAll('button')||[])].map((b)=>Math.round(b.getBoundingClientRect().height));
            return JSON.stringify({viewport:window.innerWidth, panel:Math.round(panel?.getBoundingClientRect().width||0), composer:Math.round(card?.getBoundingClientRect().width||0), widths, heights})})()`))
      )
      await shot('dsc-attach-panel-narrow.png')
      win.setContentSize(1460, 940)
      await delay(500)
      await evaluate(`document.querySelector('button[aria-label="添加附件"]')?.click(),null`)
      await delay(300)
      // 设置里的两个隔离入口
      await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find((x)=>/^\\s*设置\\s*$/.test(x.textContent||'')); b?.click(); return !!b})()`)
      await delay(500)
      await evaluate(`(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find((t)=>/数据管理|Data management/.test(t.textContent||'')); tab?.click(); return !!tab})()`)
      await delay(400)
      await shot('dsc-settings-data.png')
      console.log(
        '[panel-test] rows=' +
          (await evaluate(`JSON.stringify([...document.querySelectorAll('[role="tabpanel"] button')].map((b)=>(b.textContent||'').trim()).filter(Boolean))`))
      )
      // 提示词管理
      console.log(
        '[panel-test] promptDialog=' +
          (await evaluate(`(()=>{
            const label=[...document.querySelectorAll('[role="tabpanel"] div')]
              .find((d)=>d.children.length===0 && /^(提示词管理|Prompt manager)$/.test((d.textContent||'').trim()));
            const target=label?.closest('div[class*="cell"]')?.querySelector('button');
            target?.click(); return !!target})()`))
      )
      await delay(600)
      console.log(
        '[panel-test] promptDetail=' +
          (await evaluate(`(()=>{const d=[...document.querySelectorAll('[role="dialog"]')].find((x)=>/提示词管理|Prompt manager/.test(x.textContent||'')&&x.querySelector('li,textarea'));
            return JSON.stringify({open:!!d, checks:d?d.querySelectorAll('input[type=checkbox]').length:-1, buttons:d?[...d.querySelectorAll('button')].map((b)=>(b.textContent||'').trim()).filter(Boolean).slice(0,6):[]})})()`))
      )
      await shot('dsc-prompt-manage.png')
    }
    if (options.checkExport) {
      for (let index = 0; index < 4; index += 1) {
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
        await delay(220)
      }
      await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find((x)=>/^\\s*设置\\s*$/.test(x.textContent||'')); b?.click(); return !!b})()`)
      await delay(500)
      await evaluate(`(()=>{const tab=[...document.querySelectorAll('[role="tab"]')].find((t)=>/数据管理|Data management/.test(t.textContent||'')); tab?.click(); return !!tab})()`)
      await delay(400)
      console.log(
        '[export-test] rows=' +
          (await evaluate(`JSON.stringify([...document.querySelectorAll('[role="tabpanel"] div[class*="label"]')].map((d)=>(d.textContent||'').trim()))`))
      )
      console.log(
        '[export-test] open=' +
          (await evaluate(`(()=>{
            const label=[...document.querySelectorAll('[role="tabpanel"] div')]
              .find((d)=>d.children.length===0 && /^(对话管理|Chat manager)$/.test((d.textContent||'').trim()));
            const target=label?.closest('div[class*="cell"]')?.querySelector('button');
            target?.click(); return !!target})()`))
      )
      await delay(600)
      await evaluate(`(()=>{const d=[...document.querySelectorAll('[role="dialog"]')].find((x)=>/对话管理|Chat manager/.test(x.textContent||'')&&x.querySelector('input[type=checkbox]'));
        const all=[...d.querySelectorAll('button')].find((b)=>/全选|Select all/.test(b.textContent||'')); all?.click(); return !!all})()`)
      await delay(300)
      const base64 = await evaluate(`(async () => {
        const original = HTMLAnchorElement.prototype.click;
        let captured = null;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download) { captured = { name: this.download, href: this.href }; return; }
          return original.call(this);
        };
        const button = [...document.querySelectorAll('[role="dialog"] button')]
          .find((b) => /导出所选|Export selected/.test(b.textContent || ''));
        button?.click();
        for (let i = 0; i < 40 && !captured; i += 1) { await new Promise((r) => setTimeout(r, 100)); }
        HTMLAnchorElement.prototype.click = original;
        if (!captured) return '';
        const bytes = new Uint8Array(await (await fetch(captured.href)).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return JSON.stringify({ name: captured.name, base64: btoa(binary) });
      })()`)
      await delay(1500)
      console.log(
        '[export-test] status=' +
          (await evaluate(`(()=>{const d=[...document.querySelectorAll('[role="dialog"]')].find((x)=>/对话管理|Chat manager/.test(x.textContent||'')&&x.querySelector('input[type=checkbox]'));
            const text=d?.querySelector('[class*="status"]')?.textContent||''; return text.trim()||'none'})()`))
      )
      let parsed = null
      try {
        parsed = JSON.parse(base64 || '{}')
      } catch {
        parsed = null
      }
      if (parsed?.base64) {
        const target = path.join(os.tmpdir(), 'dsc-export.zip')
        fs.writeFileSync(target, Buffer.from(parsed.base64, 'base64'))
        console.log(`[export-test] file=${parsed.name} bytes=${Buffer.from(parsed.base64, 'base64').length}`)
        console.log('[export-test] entries=' + JSON.stringify(listZipEntries(target).slice(0, 8)))
      } else {
        console.log('[export-test] capture failed')
      }
      await shot('dsc-export-selected.png')
      // 再次导入刚导出的文件，验证可回环
      const roundTrip = path.join(os.tmpdir(), 'dsc-export.zip')
      if (fs.existsSync(roundTrip)) {
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
        await delay(300)
        try {
          win.webContents.debugger.attach('1.3')
        } catch {}
        const doc = await win.webContents.debugger.sendCommand('DOM.getDocument', { depth: -1 })
        const node = await win.webContents.debugger.sendCommand('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: 'input[type=file][accept*="zip"]',
        })
        await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
          files: [roundTrip],
          nodeId: node.nodeId,
        })
        await delay(600)
        await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find((x)=>/确认导入|^\\s*Import\\s*$/.test((x.textContent||'').trim())); b?.click(); return !!b})()`)
        await delay(5000)
        console.log(
          '[export-test] roundTrip=' +
            (await evaluate(`(()=>{const text=[...document.querySelectorAll('div')].map((d)=>d.textContent||'').find((t)=>/已导入|Imported/.test(t)&&t.length<60); return (text||'none').trim()})()`))
        )
        await shot('dsc-export-roundtrip.png')
      }
    }
    if (options.checkEditAttach) {
      for (let index = 0; index < 4; index += 1) {
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})),null`)
        await delay(220)
      }
      await evaluate(`(()=>{
        const title=[...document.querySelectorAll('div')].find((el)=>el.textContent==='分页与脑图测试'&&el.children.length===0);
        title?.parentElement?.click(); return !!title})()`)
      await delay(1500)
      console.log(
        '[edit-attach] edit=' +
          (await evaluate(`(()=>{const buttons=[...document.querySelectorAll('button[aria-label="编辑消息"]')];
            const last=buttons[buttons.length-1]; last?.click(); return buttons.length})()`))
      )
      await delay(500)
      console.log(
        '[edit-attach] before=' +
          (await evaluate(`JSON.stringify({editor:!!document.querySelector('[class*="editor"]'), panel:!!document.querySelector('[data-edit-attach-menu]')})`))
      )
      console.log(
        '[edit-attach] toggle=' +
          (await evaluate(`(()=>{const button=[...document.querySelectorAll('[class*="editor"] button[aria-label="添加附件"]')].pop();
            button?.click(); return !!button})()`))
      )
      await delay(500)
      console.log(
        '[edit-attach] after=' +
          (await evaluate(`(()=>{const panel=document.querySelector('[data-edit-attach-menu]');
            const editor=panel?.closest('[class*="editor"]');
            const options=[...(panel?.querySelectorAll('button')||[])].map((b)=>(b.textContent||'').trim());
            const widths=[...(panel?.querySelectorAll('button')||[])].map((b)=>Math.round(b.getBoundingClientRect().width));
            return JSON.stringify({panel:Math.round(panel?.getBoundingClientRect().width||0), editor:Math.round(editor?.getBoundingClientRect().width||0), options, widths})})()`))
      )
      await shot('dsc-edit-attach.png')
    }
    await shot('dsc-import-done.png')
  } catch (error) {
    console.log('[import-test] FAIL ' + error.message)
  }
  clearTimeout(watchdog)
  app.exit(0)
}

module.exports = { runImportTest }
