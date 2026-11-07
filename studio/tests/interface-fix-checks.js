// Run through the Playwright harness with `page`, `context`, `assert`, and `expect` injected.
// Set STUDIO_ROOT and optionally STUDIO_URL; otherwise the URL is read from build/studio/preview-url.txt.
const fs=await import('node:fs/promises');
const root=(process.env.STUDIO_ROOT||'').trim();
if(!root)throw new Error('STUDIO_ROOT is required');
const url=(process.env.STUDIO_URL||await fs.readFile(root+'/build/studio/preview-url.txt','utf8')).trim();
const passed=[];
const failed=[];
const run=async(name,expected,fn)=>{
  try{
    await fn();
    passed.push(name);
  }catch(error){
    failed.push({name,expected,actual:error&&error.message?error.message:String(error)});
  }
};
const equal=(actual,expected,label)=>assert.deepEqual(actual,expected,label+'\nexpected: '+JSON.stringify(expected)+'\nactual: '+JSON.stringify(actual));
const fixture=(aiEnabled=false)=>({
  version:1,
  files:[
    {path:'main.py',text:'print(1)',savedText:'print(1)',uri:'',encoding:'UTF-8'},
    {path:'English.txt',text:'A long English paragraph for browser speech testing. '.repeat(80),savedText:'A long English paragraph for browser speech testing. '.repeat(80),uri:'',encoding:'UTF-8'}
  ],
  active:'main.py',
  opened:['main.py','English.txt'],
  stdin:'',
  settings:{fontSize:15,wrap:false,timeLimit:15},
  lecture:null,
  tts:{voice:'',locale:'en-US',rate:1,resumeOffset:0,fingerprint:''},
  drawStrokes:[],
  ai:{settings:{enabled:aiEnabled,baseUrl:'https://example.com/chat/completions',apiKey:aiEnabled?'test-key':'',model:'deepseek-chat',temperature:.7,system:'test',lang:'zh',theme:'jade',view:'chat',remote:false,remoteUrl:'',autoApprove:false},messages:[]}
});
const openBridge=async(aiEnabled=false)=>{
  const bridgePage=await context.newPage();
  await bridgePage.setViewportSize({width:412,height:915});
  await bridgePage.addInitScript(initial=>{
    try{localStorage.setItem('ember-studio-mode','python');}catch(ignored){}
    window.nativeRequests=[];
    window.StudioBridge={postMessage(raw){
      const message=JSON.parse(raw);
      window.nativeRequests.push(message);
      setTimeout(()=>{
        if(message.type==='ready')window.StudioNative.receive({type:'restore',data:initial});
        else if(message.type==='snapshot')window.StudioNative.receive({type:'snapshotSaved',id:message.id,ok:true});
        else if(message.type==='gameState')window.StudioNative.receive({type:'gameState',exists:false});
        else if(message.type==='ttsStatus')window.StudioNative.receive({type:'ttsStatus',ready:true,engine:'Mock TTS',voices:[{name:'English Voice',locale:'en-US'}]});
      },0);
    }};
  },fixture(aiEnabled));
  await bridgePage.goto(url,{waitUntil:'networkidle'});
  await bridgePage.waitForSelector('#landing[data-ready="1"]');
  return bridgePage;
};
const enterMode=async(bridgePage,mode)=>{
  await bridgePage.locator('.home-card[data-mode="'+mode+'"]').click();
  await bridgePage.waitForSelector('#landing',{state:'hidden'});
  await bridgePage.waitForTimeout(450);
};
const closePage=async bridgePage=>{if(bridgePage&&!bridgePage.isClosed())await bridgePage.close();};

await run('game lobby back returns to editor','workbench visible, lounge hidden, no gameview class',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    await bridgePage.locator('#gameTab').click();
    await bridgePage.waitForSelector('#lounge:not([hidden])');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#lounge',{state:'hidden'});
    equal(await bridgePage.locator('#workbench').isVisible(),true,'workbench visibility');
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('gameview')),false,'gameview class');
  }finally{await closePage(bridgePage);}
});

await run('back from a mode opens home and a second back asks to exit','home stays open, back is true then false',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'first back');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),false,'second back');
    equal(await bridgePage.locator('#landing').isVisible(),true,'home stays visible');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),false,'repeated back still exits');
  }finally{await closePage(bridgePage);}
});

await run('home return button restores the same work','landing hidden and python file still active',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'back home');
    await bridgePage.waitForSelector('#landingBack:not([hidden])');
    await bridgePage.locator('#landingBack').click();
    await bridgePage.waitForSelector('#landing',{state:'hidden'});
    equal(await bridgePage.evaluate(()=>window.Studio.getState().active),'main.py','active file');
  }finally{await closePage(bridgePage);}
});

await run('draw mode back closes drawing layer','drawing false, drawLayer hidden, landing hidden',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'notepad');
    await bridgePage.locator('#drawToggle').click();
    await bridgePage.waitForFunction(()=>document.body.classList.contains('drawing'));
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('drawing')),false,'drawing class');
    await bridgePage.waitForSelector('#drawLayer',{state:'hidden'});
    equal(await bridgePage.locator('#landing').isHidden(),true,'landing visibility');
  }finally{await closePage(bridgePage);}
});

await run('search back closes search panel','.cm-search removed while landing stays hidden',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    await bridgePage.locator('#moreButton').click();
    await bridgePage.locator('#findButton').click();
    await bridgePage.waitForSelector('.cm-search');
    console.log('search DOM:',await bridgePage.evaluate(()=>document.querySelector('.cm-search').outerHTML.slice(0,240)));
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    equal(await bridgePage.locator('.cm-search').count(),0,'search panel count');
    equal(await bridgePage.locator('#landing').isHidden(),true,'landing visibility');
  }finally{await closePage(bridgePage);}
});

await run('AI queue survives picker','no aiCancel, same queue length, AI panel restored',async()=>{
  const bridgePage=await openBridge(true);
  try{
    await enterMode(bridgePage,'ai');
    await bridgePage.locator('#aiInput').fill('first');
    await bridgePage.locator('#aiSend').click();
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='aiRequest'));
    await bridgePage.locator('#aiInput').fill('second');
    await bridgePage.locator('#aiSend').click();
    const before=await bridgePage.evaluate(()=>window.Studio.ai().queue.length);
    equal(before,1,'queue length before back');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>nativeRequests.some(request=>request.type==='aiCancel')),false,'aiCancel request');
    equal(await bridgePage.evaluate(()=>window.Studio.ai().queue.length),before,'queue length while home is open');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),false,'second back asks to exit');
    equal(await bridgePage.locator('#landing').isVisible(),true,'home stays open');
    equal(await bridgePage.evaluate(()=>window.Studio.ai().queue.length),before,'queue survives the exit request');
  }finally{await closePage(bridgePage);}
});

await run('TTS is not stopped by picker','no ttsStop or ttsPause request',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'tts');
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='ttsStatus'));
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>nativeRequests.some(request=>request.type==='ttsStop'||request.type==='ttsPause')),false,'TTS stop/pause request');
  }finally{await closePage(bridgePage);}
});

await run('running code blocks notepad switch','notepad class absent, file count unchanged, stop available',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    await bridgePage.locator('.cm-content').fill('while True:\n    pass');
    await bridgePage.locator('#runButton').click();
    await bridgePage.waitForFunction(()=>document.getElementById('runState').textContent.includes('可停止'),null,{timeout:30000});
    const before=await bridgePage.evaluate(()=>window.Studio.getState().files.length);
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    await bridgePage.locator('.home-card[data-mode="notepad"]').click();
    await bridgePage.waitForTimeout(150);
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('notepad')),false,'notepad class');
    await bridgePage.locator('.home-card[data-mode="lecture"]').click();
    await bridgePage.waitForTimeout(150);
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('lecture')),false,'lecture class');
    equal(await bridgePage.evaluate(()=>window.Studio.getState().files.length),before,'file count');
    await bridgePage.locator('#landingBack').click();
    await bridgePage.waitForSelector('#landing',{state:'hidden'});
    await bridgePage.locator('#stopButton').click();
    await bridgePage.waitForFunction(()=>!document.getElementById('stopButton').offsetParent);
  }finally{await closePage(bridgePage);}
});

await run('Ctrl+Enter sends AI only','aiRequest present, no run effects, runState ready',async()=>{
  const bridgePage=await openBridge(true);
  try{
    await enterMode(bridgePage,'ai');
    await bridgePage.locator('#aiInput').fill('hello');
    await bridgePage.locator('#aiInput').press('Control+Enter');
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='aiRequest'));
    const requests=await bridgePage.evaluate(()=>nativeRequests.map(request=>request.type));
    equal(requests.filter(type=>['aiRequest','play','preview'].includes(type)),['aiRequest'],'native request sequence');
    equal(await bridgePage.locator('#runState').innerText(),'就绪','run state');
  }finally{await closePage(bridgePage);}
});

await run('flush happens before landing','snapshot request precedes visible landing and contains draft',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    await bridgePage.evaluate(()=>{
      window.__backOrder=[];
      const original=window.StudioBridge.postMessage.bind(window.StudioBridge);
      window.StudioBridge.postMessage=raw=>{const message=JSON.parse(raw);if(message.type==='snapshot')window.__backOrder.push('snapshot');original(raw);};
      const landing=document.getElementById('landing');
      let seen=false;
      new MutationObserver(()=>{if(!landing.hidden&&!seen){seen=true;window.__backOrder.push('landing');}}).observe(landing,{attributes:true,attributeFilter:['hidden']});
    });
    const draft='# flushed before landing\nprint("saved-first")\n';
    await bridgePage.locator('.cm-content').fill(draft);
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    const result=await bridgePage.evaluate(()=>({order:window.__backOrder,snapshots:nativeRequests.filter(request=>request.type==='snapshot')}));
    equal(result.order[0],'snapshot','request order');
    equal(result.order.includes('landing'),true,'landing observed');
    equal(result.snapshots.some(request=>request.data.files.some(file=>file.text.includes('saved-first'))),true,'snapshot draft');
  }finally{await closePage(bridgePage);}
});

await run('new AI session cancels the in-flight request','aiCancel is sent and the session is no longer busy',async()=>{
  const bridgePage=await openBridge(true);
  try{
    await enterMode(bridgePage,'ai');
    await bridgePage.locator('#aiInput').fill('please keep working');
    await bridgePage.locator('#aiSend').click();
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='aiRequest'));
    await bridgePage.locator('#aiNewSession').click();
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='aiCancel'));
    const state=await bridgePage.evaluate(()=>({busy:window.Studio.ai().busy,messages:window.Studio.ai().messages.length,cancels:nativeRequests.filter(request=>request.type==='aiCancel').length}));
    equal(state.busy,false,'busy');
    equal(state.messages,0,'messages');
    equal(state.cancels>0,true,'cancel count');
  }finally{await closePage(bridgePage);}
});

await run('reselecting the current card does not leave the file','notepad path stays after a second entry',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'notepad');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'back home');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    await bridgePage.locator('.home-card[data-mode="notepad"]').click();
    await bridgePage.waitForSelector('#landing',{state:'hidden'});
    equal(await bridgePage.evaluate(()=>window.Studio.getState().active),'笔记.txt','active file');
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('notepad')),true,'notepad class');
  }finally{await closePage(bridgePage);}
});

await run('lecture subview back returns to notes before home','timeline click then back stays in lecture on notes',async()=>{
  const bridgePage=await openBridge();
  try{
    await bridgePage.setViewportSize({width:390,height:844});
    await enterMode(bridgePage,'lecture');
    await bridgePage.locator('.lecture-tab[data-tab="timeline"]').click();
    equal(await bridgePage.evaluate(()=>document.body.dataset.lectureTab),'timeline','tab before back');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'back');
    equal(await bridgePage.evaluate(()=>document.body.dataset.lectureTab||'notes'),'notes','tab after back');
    equal(await bridgePage.locator('#landing').isHidden(),true,'still in lecture');
  }finally{await closePage(bridgePage);}
});

await run('game opened from home returns home','mode stays game and the homepage is visible',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'game');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'back');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>window.Studio.getState().mode),'game','mode');
  }finally{await closePage(bridgePage);}
});

await run('home layout stays reachable on short and landscape screens','logo, title and cards do not overlap and the last card can scroll into view',async()=>{
  const bridgePage=await openBridge();
  try{
    const css=await bridgePage.evaluate(()=>[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules].map(rule=>rule.cssText);}catch(e){return [];}}).join('\n'));
    equal(css.includes('env(safe-area-inset-top)'),true,'top safe area');
    equal(css.includes('env(safe-area-inset-left)'),true,'left safe area');
    equal(css.includes('env(safe-area-inset-right)'),true,'right safe area');
    const sizes=[[320,568],[360,640],[390,844],[640,360]];
    for(const [width,height] of sizes){
      await bridgePage.setViewportSize({width,height});
      const measure=await bridgePage.evaluate(insets=>{
        const landing=document.getElementById('landing');
        landing.style.paddingTop=(8+insets.top)+'px';
        landing.style.paddingRight=(8+insets.right)+'px';
        landing.style.paddingBottom=(8+insets.bottom)+'px';
        landing.style.paddingLeft=(8+insets.left)+'px';
        const back=document.getElementById('landingBack');
        back.hidden=false;
        const scroller=document.getElementById('homeScroll');
        scroller.scrollTop=0;
        const overlap=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
        const box=landing.getBoundingClientRect();
        const brand=document.getElementById('homeBrand').getBoundingClientRect();
        const title=document.getElementById('homeTitle').getBoundingClientRect();
        const status=document.querySelector('.home-status').getBoundingClientRect();
        const first=document.querySelector('.home-card[data-mode="python"]').getBoundingClientRect();
        const last=document.querySelector('.home-card[data-mode="game"]');
        last.scrollIntoView({block:'end'});
        const reached=last.getBoundingClientRect();
        const view=landing.getBoundingClientRect();
        return {
          brandTitle:overlap(brand,title),
          brandStatus:overlap(brand,status),
          titleStatus:overlap(title,status),
          brandBack:overlap(brand,back.getBoundingClientRect()),
          brandInside:brand.left>=box.left-1&&brand.right<=box.right+1&&brand.top>=box.top-1,
          firstWidth:first.width,
          lastVisible:reached.top<view.bottom-2&&reached.bottom>view.top+2&&reached.left>=view.left-1&&reached.right<=view.right+1,
          scrollWidth:document.documentElement.scrollWidth,
          innerWidth:window.innerWidth
        };
      },{top:47,right:34,bottom:21,left:34});
      equal(measure.brandTitle,false,width+'x'+height+' brand/title');
      equal(measure.brandStatus,false,width+'x'+height+' brand/status');
      equal(measure.titleStatus,false,width+'x'+height+' title/status');
      equal(measure.brandBack,false,width+'x'+height+' brand/back');
      equal(measure.brandInside,true,width+'x'+height+' brand inside');
      equal(measure.firstWidth>40,true,width+'x'+height+' card width');
      equal(measure.lastVisible,true,width+'x'+height+' last card');
      equal(measure.scrollWidth<=measure.innerWidth+1,true,width+'x'+height+' overflow');
    }
  }finally{await closePage(bridgePage);}
});

const report={checks:passed.length+failed.length,passed,failed,env:{viewport:'412x915 plus home sizes',mode:'browser'}};
await fs.mkdir(root+'/artifacts/studio-v0.1',{recursive:true});
if(failed.length===0){
  await fs.writeFile(root+'/artifacts/studio-v0.1/interface-fix-checks.json',JSON.stringify(report,null,2)+'\n');
}else{
  console.log(JSON.stringify(report,null,2));
}
for(const item of failed)console.log('FAILED '+item.name+'\n  expected: '+item.expected+'\n  actual: '+item.actual);
globalThis.__studioInterfaceFixReport=report;
