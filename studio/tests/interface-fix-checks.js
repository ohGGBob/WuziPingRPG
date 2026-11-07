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
  drawView:null,
  ai:{settings:{enabled:aiEnabled,baseUrl:'https://example.com/chat/completions',apiKey:aiEnabled?'test-key':'',model:'deepseek-chat',temperature:.7,system:'test',lang:'zh',theme:'jade',view:'chat',remote:false,remoteUrl:'',autoApprove:false,agentLoop:true},messages:[]}
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
const openPreview=async()=>{
  const previewPage=await context.newPage();
  await previewPage.setViewportSize({width:412,height:915});
  await previewPage.addInitScript(initial=>{
    try{
      localStorage.setItem('ember-studio-mode','python');
      localStorage.setItem('ember-studio-v1',JSON.stringify(initial));
    }catch(ignored){}
  },fixture());
  await previewPage.goto(url,{waitUntil:'networkidle'});
  await previewPage.waitForSelector('#landing[data-ready="1"]');
  return previewPage;
};
const enterMode=async(bridgePage,mode)=>{
  await bridgePage.locator('.wheel-item[data-mode="'+mode+'"]').click({force:true});
  await bridgePage.evaluate(()=>document.getElementById('enterMode').click());
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

await run('editor back opens the landing screen','first Studio.back true and landing visible',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'first back');
    await bridgePage.waitForSelector('#landing:not([hidden])');
  }finally{await closePage(bridgePage);}
});

await run('landing back requests native exit','second Studio.back false and landing remains visible',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'first back');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),false,'second back');
    await bridgePage.waitForTimeout(100);
    equal(await bridgePage.locator('#landing').isVisible(),true,'landing visibility');
  }finally{await closePage(bridgePage);}
});

await run('landing return button cancels picker','mode and files unchanged, editor restored',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    const before=await bridgePage.evaluate(()=>({mode:window.Studio.getState().mode,files:window.Studio.getState().files.length}));
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'first back');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    await bridgePage.locator('#landingBack').click();
    await bridgePage.waitForSelector('#landing',{state:'hidden'});
    const after=await bridgePage.evaluate(()=>({mode:window.Studio.getState().mode,files:window.Studio.getState().files.length}));
    equal(after,before,'mode/files after cancel');
    equal(await bridgePage.locator('#workbench').isVisible(),true,'workbench visibility');
  }finally{await closePage(bridgePage);}
});

await run('preview return button cancels picker','non-native preview restores editor',async()=>{
  const previewPage=await openPreview();
  try{
    await enterMode(previewPage,'python');
    equal(await previewPage.evaluate(()=>window.Studio.back()),true,'first back');
    await previewPage.waitForSelector('#landing:not([hidden])');
    await previewPage.locator('#landingBack').click();
    await previewPage.waitForSelector('#landing',{state:'hidden'});
    equal(await previewPage.locator('#workbench').isVisible(),true,'workbench visibility');
    equal(await previewPage.evaluate(()=>typeof window.StudioBridge),'undefined','native bridge');
  }finally{await closePage(previewPage);}
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
    equal(await bridgePage.evaluate(()=>window.Studio.ai().queue.length),before,'queue length while picker open');
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

await run('running code blocks editor-mode switches','Ctrl+S feedback, lecture/notepad blocked, stop available',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    await bridgePage.locator('.cm-content').fill('while True:\n    pass');
    await bridgePage.locator('#runButton').click();
    await bridgePage.waitForFunction(()=>document.getElementById('runState').textContent.includes('可停止'),null,{timeout:30000});
    const before=await bridgePage.evaluate(()=>window.Studio.getState().files.length);
    await bridgePage.keyboard.press('Control+S');
    await bridgePage.waitForFunction(()=>!document.getElementById('toast').hidden);
    equal(await bridgePage.locator('#toast').innerText(),'运行中无法写回文件，请先停止运行','Ctrl+S notice');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    await bridgePage.evaluate(()=>document.getElementById('enterMode').click());
    await bridgePage.waitForSelector('#landing',{state:'hidden'});
    equal(await bridgePage.evaluate(()=>window.Studio.getState().mode),'python','current mode cancel');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'reopen landing');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    await bridgePage.locator('.wheel-item[data-mode="notepad"]').click({force:true});
    await bridgePage.evaluate(()=>document.getElementById('enterMode').click());
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('notepad')),false,'notepad class');
    await bridgePage.locator('.wheel-item[data-mode="lecture"]').click({force:true});
    await bridgePage.evaluate(()=>document.getElementById('enterMode').click());
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('lecture')),false,'lecture class');
    equal(await bridgePage.evaluate(()=>window.Studio.getState().files.length),before,'file count');
    await bridgePage.evaluate(()=>document.getElementById('enterMode').click());
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

const report={checks:passed.length+failed.length,passed,failed,env:{viewport:'412x915',mode:'browser'}};
await fs.mkdir(root+'/artifacts/studio-v0.1',{recursive:true});
if(failed.length===0){
  await fs.writeFile(root+'/artifacts/studio-v0.1/interface-fix-checks.json',JSON.stringify(report,null,2)+'\n');
}else{
  console.log(JSON.stringify(report,null,2));
}
for(const item of failed)console.log('FAILED '+item.name+'\n  expected: '+item.expected+'\n  actual: '+item.actual);
globalThis.__studioInterfaceFixReport=report;
