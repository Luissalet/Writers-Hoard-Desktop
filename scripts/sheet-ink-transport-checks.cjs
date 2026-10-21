const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {BrowserWindow}=require('electron');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.checkSheetInk=async({win,call,rpc,directory})=>{
  const folder=process.env.SHEET_INK_EVIDENCE||path.join(directory,'sheet-ink');fs.mkdirSync(folder,{recursive:true});
  const data=await win.webContents.executeJavaScript('window.__transportSheetInk'),scope={projectId:data.projectId,eraId:data.eraId,sheetId:data.sheetId};
  for(const [name,url]of Object.entries(data.pixels))fs.writeFileSync(path.join(folder,'mask-'+name+'.png'),Buffer.from(url.split(',')[1],'base64'));
  const initial=await call('wh_sheet_get',scope),base=await call('wh_sheet_get',{projectId:data.projectId,sheetId:data.sheetId});assert(!base.sheet.ink);
  let saved=await call('wh_sheet_ink_action',{...scope,revision:initial.sheet.revision,action:'draw',tool:'pen',color:data.red.color,width:data.red.width,points:data.red.points});
  const red=structuredClone(saved.sheet.ink),originalFields=JSON.stringify({...saved.sheet,ink:undefined,revision:undefined,updatedAt:undefined});
  const stale=await rpc('tools/call',{name:'wh_sheet_ink_action',arguments:{...scope,revision:initial.sheet.revision,action:'undo'}});assert(stale.result.isError,'ink stale revision rejected');
  saved=await call('wh_sheet_ink_action',{...scope,revision:saved.sheet.revision,action:'erase',width:data.eraser.width,points:data.eraser.points});assert.equal(saved.sheet.ink.strokes.length,2);
  saved=await call('wh_sheet_ink_action',{...scope,revision:saved.sheet.revision,action:'undo'});assert.deepEqual(saved.sheet.ink,red,'native eraser Undo restores exact operation');
  saved=await call('wh_sheet_ink_action',{...scope,revision:saved.sheet.revision,action:'erase',width:data.eraser.width,points:data.eraser.points});
  saved=await call('wh_sheet_ink_action',{...scope,revision:saved.sheet.revision,action:'draw',tool:'marker',color:'#2464ee',width:12,points:[{x:180,y:120,pressure:.5},{x:220,y:120,pressure:1}]});
  assert.equal(JSON.stringify({...saved.sheet,ink:undefined,revision:undefined,updatedAt:undefined}),originalFields,'ink changes sheet data/rules');assert(!(await call('wh_sheet_get',{projectId:data.projectId,sheetId:data.sheetId})).sheet.ink,'era writes changed Base');
  const json=await call('wh_sheet_export',scope);assert.deepEqual(JSON.parse(json.json).sheet.ink,saved.sheet.ink);
  const imported=await call('wh_sheet_import',{projectId:data.projectId,json:json.json});assert.deepEqual(imported.sheet.ink,saved.sheet.ink,'normal JSON import retains ink');
  const paperImage=await call('wh_export_document_image',{projectId:data.projectId,eraId:data.eraId,kind:'character-sheets',entityId:data.sheetId,width:1000,pageHeight:1400});
  for(const page of paperImage.pages)fs.writeFileSync(path.join(folder,'paper-era-'+page.index+'.png'),Buffer.from(page.dataUrl.split(',')[1],'base64'));
  saved=await call('wh_sheet_ink_action',{...scope,revision:saved.sheet.revision,action:'draw',color:'#c4463a',width:12,points:[{x:100,y:8000},{x:300,y:8000}]});
  const extended=await call('wh_export_document_image',{projectId:data.projectId,eraId:data.eraId,kind:'character-sheets',entityId:data.sheetId,width:1000,pageHeight:1400});assert(extended.height>paperImage.height+3000,'Ink beyond text bounds was clipped');fs.writeFileSync(path.join(folder,'paper-extended-last.png'),Buffer.from(extended.pages.at(-1).dataUrl.split(',')[1],'base64'));
  saved=await call('wh_sheet_ink_action',{...scope,revision:saved.sheet.revision,action:'undo'});assert.equal(saved.sheet.ink.strokes.length,3);
  const reader=await call('wh_reader_export',{projectId:data.projectId,eraId:data.eraId,locale:'en'}),wiki=await call('wh_wiki_export',{projectId:data.projectId,eraId:data.eraId,locale:'en'});
  for(const [kind,exported]of [['reader',reader],['wiki',wiki]]){
    assert(exported.html.includes('data-sheet-paper="paper-v1"')&&exported.html.includes('data-sheet-ink="true"')&&exported.html.includes('<mask'),'normal '+kind+' ink/paper omitted');
    const file=path.join(folder,kind+'-offline.html');fs.writeFileSync(file,exported.html);const browser=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false,partition:'ink-'+kind+'-'+Date.now()}}),requests=[];
    browser.webContents.session.webRequest.onBeforeRequest((details,callback)=>{if(/^https?:/i.test(details.url)){requests.push(details.url);callback({cancel:true});}else callback({});});
    try{await browser.loadFile(file);await delay(200);assert(await browser.webContents.executeJavaScript('Boolean(document.querySelector("[data-sheet-paper] mask"))'));fs.writeFileSync(path.join(folder,kind+'-offline.png'),(await browser.webContents.capturePage()).toPNG());assert.equal(requests.length,0);}finally{browser.destroy();}
  }
  assert.deepEqual(await win.webContents.executeJavaScript('window.__sheetInk.portability()'),{jsonClone:true,zipRestore:true,operations:3});
  for(const width of [1440,640]){
    win.setContentSize(width,1000);await win.webContents.executeJavaScript('window.__sheetInk.show("editor")');await win.webContents.executeJavaScript('window.__sheetInk.stroke()');
    let uiSaved=await win.webContents.executeJavaScript('window.__sheetInk.save()');assert(uiSaved.ink.strokes.some(stroke=>stroke.points.some(point=>point.pressure===1)),'simulated pen pressure persisted');assert(Math.abs(uiSaved.ink.strokes.at(-1).points[0].x-100)<1&&Math.abs(uiSaved.ink.strokes.at(-1).points[0].y-120)<1,'Stable paper coordinates '+width+' '+JSON.stringify(uiSaved.ink.strokes.at(-1).points[0]));
    await win.webContents.executeJavaScript('window.__sheetInk.stroke("eraser")');await win.webContents.executeJavaScript('window.__sheetInk.undo()');uiSaved=await win.webContents.executeJavaScript('window.__sheetInk.save()');assert.equal(uiSaved.ink.strokes.at(-1).tool,'pen','UI eraser Undo');
    await win.webContents.executeJavaScript('window.__sheetInk.focusPaper()');await delay(300);fs.writeFileSync(path.join(folder,'editor-'+width+'.png'),(await win.webContents.capturePage()).toPNG());assert(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=window.innerWidth'),'narrow ink overflow');
    await win.webContents.executeJavaScript('window.__sheetInk.show("reader",true)');await delay(250);assert(await win.webContents.executeJavaScript('Boolean(document.querySelector("[data-sheet-paper] mask"))'),'normal ReadingView ink not hydrated');fs.writeFileSync(path.join(folder,'reading-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify({pureTests:data.pureTests,externalMcp:true,eraOnly:true,cas:true,json:true,zip:true,readerOfflineNoHttp:true,wikiOfflineNoHttp:true,normalUi:[1440,640],paperImage:{width:paperImage.width,height:paperImage.height,pages:paperImage.pages.length}},null,2));
  console.log('PASS sheet ink: pressure/mask/Undo pixels, native MCP/CAS/Base-era/JSON/ZIP, full PNG and offline Reader/wiki noHTTP, actual normal editor/ReadingView1440/640');
};
