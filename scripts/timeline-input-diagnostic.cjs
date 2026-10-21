// QA only: retain the original oracle and inspect Chromium's native input route.
const {app}=require('electron');
const {main}=require('./run-codex-properties-ui.cjs');
main({window(win){
  const send=win.webContents.sendInputEvent.bind(win.webContents);
  win.webContents.on('zoom-changed',(_e,direction)=>console.log('NATIVE_ZOOM '+direction));
  win.webContents.on('before-input-event',(_e,input)=>console.log('NATIVE_KEY '+JSON.stringify(input)));
  win.webContents.sendInputEvent=event=>{
    if(event.type==='mouseWheel'&&event.modifiers?.includes('control')){
      console.log('NATIVE_CTRL_WHEEL '+JSON.stringify(event));
      send({type:'keyDown',keyCode:'Control'});
      send(event);
      setTimeout(()=>{if(!win.isDestroyed())send({type:'keyUp',keyCode:'Control'});},100);
    }else send(event);
  };
}}).catch(error=>{console.error(error.stack||error);app.exit(1);});
