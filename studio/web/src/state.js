import {defaultTabState,sanitizeTabState} from './tabs.js';

export const DEFAULT_HOME_SETTINGS={
  aiHandle:true,
  timetableDefaultOpen:false,
  showWeekend:true,
  showEvening:true
};

export function defaultUi(){
  return {
    activeTab:'home',
    tabs:defaultTabState('home'),
    timetableOpen:false,
    aiHandle:{yRatio:0.43},
    homeSettings:{...DEFAULT_HOME_SETTINGS},
    recentMode:'time'
  };
}

const ratio=(value,fallback)=>{
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0.14,Math.min(0.9,n)):fallback;
};

export function sanitizeUi(raw){
  const value=raw&&typeof raw==='object'?raw:{};
  const base=defaultUi();
  const tabs=sanitizeTabState(value.tabs||{activeTab:value.activeTab});
  const settings=value.homeSettings&&typeof value.homeSettings==='object'?value.homeSettings:{};
  const handle=value.aiHandle&&typeof value.aiHandle==='object'?value.aiHandle:{};
  const homeSettings={
    aiHandle:settings.aiHandle!==false,
    timetableDefaultOpen:settings.timetableDefaultOpen===true,
    showWeekend:settings.showWeekend!==false,
    showEvening:settings.showEvening!==false
  };
  return {
    activeTab:tabs.activeTab,
    tabs,
    timetableOpen:typeof value.timetableOpen==='boolean'?value.timetableOpen:homeSettings.timetableDefaultOpen,
    aiHandle:{
      yRatio:ratio(handle.yRatio,base.aiHandle.yRatio)
    },
    homeSettings,
    recentMode:['time','source','format'].includes(value.recentMode)?value.recentMode:'time'
  };
}
