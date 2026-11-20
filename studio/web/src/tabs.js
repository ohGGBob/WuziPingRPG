export const TABS=['recent','home','profile'];

export const TAB_META={
  recent:{title:'最近',icon:'◷'},
  home:{title:'首页',icon:'⌂'},
  profile:{title:'我的',icon:'◎'}
};

const tabOf=value=>TABS.includes(value)?value:'home';
const pageOf=value=>typeof value==='string'&&value?value.slice(0,80):'';

export function defaultTabState(activeTab='home'){
  return {
    activeTab:tabOf(activeTab),
    stacks:{recent:[],home:[],profile:[]},
    scroll:{recent:0,home:0,profile:0}
  };
}

export function sanitizeTabState(raw){
  const value=raw&&typeof raw==='object'?raw:{};
  const base=defaultTabState(value.activeTab);
  for(const tab of TABS){
    const stack=Array.isArray(value.stacks&&value.stacks[tab])?value.stacks[tab]:[];
    base.stacks[tab]=stack.map(pageOf).filter(Boolean).slice(-12);
    const top=Number(value.scroll&&value.scroll[tab]);
    base.scroll[tab]=Number.isFinite(top)?Math.max(0,Math.round(top)):0;
  }
  return base;
}

export function selectTab(state,tab){
  const next=sanitizeTabState(state);
  next.activeTab=tabOf(tab);
  return next;
}

export function tabDepth(state,tab=null){
  const next=sanitizeTabState(state);
  return next.stacks[tabOf(tab||next.activeTab)].length;
}

export function openTabPage(state,page,tab=null){
  const next=sanitizeTabState(state);
  const target=tabOf(tab||next.activeTab);
  const id=pageOf(page);
  if(!id)return next;
  if(next.stacks[target][next.stacks[target].length-1]!==id)next.stacks[target].push(id);
  next.activeTab=target;
  return next;
}

export function closeTabPage(state,tab=null){
  const next=sanitizeTabState(state);
  const target=tabOf(tab||next.activeTab);
  next.stacks[target].pop();
  return {state:next,page:next.stacks[target][next.stacks[target].length-1]||''};
}

export function clearTabStack(state,tab=null){
  const next=sanitizeTabState(state);
  next.stacks[tabOf(tab||next.activeTab)]=[];
  return next;
}

export function rememberTabScroll(state,scrollTop,tab=null){
  const next=sanitizeTabState(state);
  const target=tabOf(tab||next.activeTab);
  const n=Number(scrollTop);
  next.scroll[target]=Number.isFinite(n)?Math.max(0,Math.round(n)):0;
  return next;
}

export function resolveTabBack(state){
  const next=sanitizeTabState(state);
  const tab=next.activeTab;
  if(next.stacks[tab].length){
    const closed=closeTabPage(next,tab);
    return {action:'page',tab,page:closed.page,state:closed.state};
  }
  if(tab!=='home')return {action:'home',tab:'home',state:selectTab(next,'home')};
  return {action:'exit',tab,state:next};
}

export function reselectTab(state,tab){
  const next=sanitizeTabState(state);
  const target=tabOf(tab);
  const hadPage=next.stacks[target].length>0;
  return {
    state:clearTabStack(selectTab(next,target),target),
    action:hadPage?'root':'top'
  };
}
