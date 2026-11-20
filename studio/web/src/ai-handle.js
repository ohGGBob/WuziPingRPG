export const AI_HANDLE_WIDTH=30;
export const AI_HANDLE_HEIGHT=92;
export const AI_HANDLE_MIN=140;
export const AI_HANDLE_MAX=748;
export const AI_HANDLE_OPEN_DX=-72;
export const AI_HANDLE_MAX_OFFSET=96;

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));

export function handleTop(yRatio,viewportHeight=844){
  const max=Math.min(AI_HANDLE_MAX,Math.max(AI_HANDLE_MIN,viewportHeight-AI_HANDLE_HEIGHT-70));
  const ratioValue=Number(yRatio);
  return clamp((Number.isFinite(ratioValue)?ratioValue:0.43)*max,AI_HANDLE_MIN,max);
}

export function handleRatio(top,viewportHeight=844){
  const max=Math.min(AI_HANDLE_MAX,Math.max(AI_HANDLE_MIN,viewportHeight-AI_HANDLE_HEIGHT-70));
  const topValue=Number(top);
  return clamp((Number.isFinite(topValue)?topValue:AI_HANDLE_MIN)/max,AI_HANDLE_MIN/max,1);
}

export function planHandleGesture({dx=0,dy=0}={}){
  const x=Number(dx)||0,y=Number(dy)||0;
  const horizontal=Math.abs(x)>Math.abs(y)*1.2;
  if(horizontal&&Math.abs(x)>Math.abs(y))return x<=AI_HANDLE_OPEN_DX?{action:'open'}:{action:'cancel'};
  if(Math.hypot(x,y)<8)return {action:'open'};
  return {action:'drag',dy:y};
}

export function handleOffset(dx=0){
  const value=Number(dx);
  return Math.max(-AI_HANDLE_MAX_OFFSET,Math.min(0,Number.isFinite(value)?value:0));
}

export function bindAiHandle(element,{
  getViewportHeight=()=>window.innerHeight,
  getRatio=()=>0.43,
  setRatio=()=>{},
  onOpen=()=>{}
}={}){
  if(!element)return {cancel(){},sync(){}};
  let dragging=false,startX=0,startY=0,startTop=0,top=handleTop(getRatio(),getViewportHeight()),ready=false;
  const label=element.querySelector('small');
  const hint=element.ownerDocument.getElementById('aiHandleHint');
  const reset=()=>{element.style.transform='translateX(0)';element.dataset.ready='0';if(label)label.textContent='AI';if(hint)hint.hidden=true;};
  const sync=()=>{top=handleTop(getRatio(),getViewportHeight());element.style.top=top+'px';if(!dragging)reset();};
  const cancel=()=>{dragging=false;ready=false;sync();};
  element.addEventListener('pointerdown',event=>{
    dragging=true;ready=false;startX=event.clientX;startY=event.clientY;startTop=top;
    try{element.setPointerCapture(event.pointerId);}catch(e){}
  });
  element.addEventListener('pointermove',event=>{
    if(!dragging)return;
    const dx=event.clientX-startX,dy=event.clientY-startY;
    const horizontal=Math.abs(dx)>Math.abs(dy)*1.2;
    if(horizontal){
      const offset=handleOffset(dx);
      element.style.transform='translateX('+offset+'px)';
      ready=dx<=AI_HANDLE_OPEN_DX;
      element.dataset.ready=ready?'1':'0';
      if(label)label.textContent=ready?'松开':'AI';
      if(hint){hint.hidden=!ready;if(ready){hint.textContent='松开进入 AI';hint.style.top=(top+30)+'px';}}
      return;
    }
    element.style.transform='translateX(0)';
    ready=false;
    const max=Math.min(AI_HANDLE_MAX,Math.max(AI_HANDLE_MIN,getViewportHeight()-AI_HANDLE_HEIGHT-70));
    top=clamp(startTop+dy,AI_HANDLE_MIN,max);
    element.style.top=top+'px';
  });
  const finish=event=>{
    if(!dragging)return;
    const plan=planHandleGesture({dx:event.clientX-startX,dy:event.clientY-startY});
    const wasOpen=plan.action==='open';
    dragging=false;ready=false;reset();
    setRatio(handleRatio(top,getViewportHeight()));
    sync();
    if(wasOpen)onOpen();
  };
  element.addEventListener('pointerup',finish);
  element.addEventListener('pointercancel',cancel);
  element.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();
    onOpen();
  });
  sync();
  return {cancel,sync,get dragging(){return dragging;}};
}
