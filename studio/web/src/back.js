export const BACK={
  DIALOG:'dialog',
  DRAWER:'drawer',
  DRAW:'draw',
  SEARCH:'search',
  LANDING:'landing',
  PASS:'pass'
};

export function resolveBack(ctx){
  const value=ctx&&typeof ctx==='object'?ctx:{};
  const now=Number.isFinite(value.now)?value.now:0;
  if(value.dialogOpen)return {action:BACK.DIALOG,nextLastBackAt:0};
  if(value.drawerOpen)return {action:BACK.DRAWER,nextLastBackAt:0};
  if(value.drawing)return {action:BACK.DRAW,nextLastBackAt:0};
  if(value.searchOpen)return {action:BACK.SEARCH,nextLastBackAt:0};
  /* The home screen is the top of the in-app stack. Hand control back to the
     Android host so its exit confirmation is shown instead of returning to the
     previous mode. */
  if(value.landingOpen)return {action:BACK.PASS,nextLastBackAt:0};
  return {action:BACK.LANDING,nextLastBackAt:now};
}
