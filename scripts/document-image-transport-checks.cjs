const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {nativeImage}=require('electron');
const hash=data=>createHash('sha256').update(data).digest('hex');
exports.checkDocumentImages=async({win,call,rpc,directory})=>{
  const output=process.env.DOCUMENT_IMAGE_EVIDENCE||path.join(directory,'document-images');fs.mkdirSync(output,{recursive:true});
  const fixture=await win.webContents.executeJavaScript('window.__transportImageFixture'),results=[];
  for(const [kind,entityId]of Object.entries(fixture.ids))for(const eraId of [undefined,fixture.eraId]){
    const request={projectId:fixture.projectId,eraId,kind,entityId,width:960,pageHeight:1400,pixelRatio:1,locale:'en'};
    const result=await call('wh_export_document_image',request);
    assert.equal(result.sourceVersion,fixture.versions[kind][eraId?'era':'base'],kind+' source version');assert.equal(result.eraId,eraId??null);assert.equal(result.kind,kind);assert(result.pages.length>0);
    let area=0;const prefix=kind+'-'+(eraId?'era':'base');
    for(const page of result.pages){
      const bytes=Buffer.from(page.dataUrl.split(',')[1],'base64'),size=nativeImage.createFromBuffer(bytes).getSize();
      assert.equal(size.width,page.width);assert.equal(size.height,page.height);assert.equal(size.width,page.pixelWidth);assert.equal(size.height,page.pixelHeight);
      assert(page.x>=0&&page.y>=0&&page.x+page.width<=result.width&&page.y+page.height<=result.height);assert(page.width<=960&&page.height<=1400);area+=page.width*page.height;
      fs.writeFileSync(path.join(output,prefix+'-'+page.index+'.png'),bytes);
    }
    assert.equal(area,result.width*result.height,'complete tile coverage '+kind);
    if(kind==='writings'){assert(result.pages.length>1);const last=nativeImage.createFromDataURL(result.pages.at(-1).dataUrl).toBitmap();let marked=0;for(let i=0;i<last.length;i+=4)if(last[i]<100&&last[i+1]>150&&last[i+2]>180)marked++;assert(marked>100,'last manuscript mark rendered in final tile');}
    const {pages,...metadata}=result;results.push({...metadata,pages:pages.map(({dataUrl,...page})=>({...page,sha256:hash(dataUrl)}))});
    console.log('PASS image '+prefix+' '+result.width+'x'+result.height+' '+pages.length+' PNG');
  }
  const note={projectId:fixture.projectId,kind:'notes',entityId:fixture.ids.notes,width:640,pageHeight:1024,pixelRatio:2};
  const first=await call('wh_export_document_image',note),second=await call('wh_export_document_image',note);
  assert.equal(first.pages[0].pixelWidth,1280);assert.equal(first.pages[0].pixelHeight,first.pages[0].height*2);assert.equal(hash(first.pages[0].dataUrl),hash(second.pages[0].dataUrl),'deterministic note pixels');
  const video=await call('wh_export_document_image',{projectId:fixture.projectId,kind:'media',entityId:fixture.videoId,width:640});assert(video.pages.length>0);fs.writeFileSync(path.join(output,'media-video-initial.png'),Buffer.from(video.pages[0].dataUrl.split(',')[1],'base64'));
  const calculated=await call('wh_export_document_image',{projectId:fixture.projectId,kind:'tables',entityId:fixture.calculatedTableId,width:640});assert(calculated.pages.length>0);fs.writeFileSync(path.join(output,'tables-calculated.png'),Buffer.from(calculated.pages[0].dataUrl.split(',')[1],'base64'));
  const view={x:-240,y:-120,w:900,h:600},framed=await call('wh_export_document_image',{projectId:fixture.projectId,kind:'board',entityId:fixture.ids.board,width:640,view});
  assert.equal(framed.framing.mode,'view');assert.deepEqual(framed.framing.view,view);
  const foreign=await rpc('tools/call',{name:'wh_export_document_image',arguments:{projectId:'transport-world',kind:'codex',entityId:fixture.ids.codex}});assert(foreign.result.isError,'foreign owner rejected');
  assert.deepEqual(await win.webContents.executeJavaScript('window.__imageFixtureSnapshot()'),fixture.before,'all Base/era source versions unchanged');
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({results,deterministicNote:true,pixelRatio2:true,sourceImmutable:true},null,2));
  await win.webContents.executeJavaScript('window.__imageShowLibrary()');
  for(const width of [1440,640]){
    win.setSize(width,1000);await new Promise(resolve=>setTimeout(resolve,250));
    const opened=await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('[data-library-image]')].find(node=>node.getAttribute('data-library-image').includes('image-writing'));button?.click();return Boolean(button);})()`);assert(opened,'normal Library PNG action');
    await new Promise(resolve=>setTimeout(resolve,150));
    await win.webContents.executeJavaScript(`(()=>{const dialog=document.querySelector('[data-testid="document-image-dialog"]'),input=dialog.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'640');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await win.webContents.executeJavaScript(`([...document.querySelectorAll('[data-testid="document-image-dialog"] button')].find(node=>node.textContent==='Render image')).click()`);
    const until=Date.now()+45000;while(!await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-testid="document-image-dialog"] [role="status"]'))`)){const error=await win.webContents.executeJavaScript(`document.querySelector('[data-testid="document-image-dialog"] [role="alert"]')?.textContent`);assert(!error,error);if(Date.now()>until)throw Error('Normal UI image timed out');await new Promise(resolve=>setTimeout(resolve,50));}
    assert(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=window.innerWidth'),'viewport overflow '+width);
    await new Promise(resolve=>setTimeout(resolve,400));
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
    // A hidden window's first capture can expose a frame from before the
    // async compositor reply. Keep that frame, repaint, then capture the settled UI.
    fs.writeFileSync(path.join(output,'library-image-'+width+'-first-frame.png'),(await win.webContents.capturePage()).toPNG());
    win.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,250));
    assert(await win.webContents.executeJavaScript(`(()=>{const dialog=document.querySelector('[data-testid="document-image-dialog"]');return dialog.querySelector('input').value==='640'&&dialog.querySelector('[role="status"]').textContent.startsWith('640 ×')&&dialog.querySelectorAll('figure img').length===3;})()`),'settled image UI state '+width);
    fs.writeFileSync(path.join(output,'library-image-'+width+'.png'),(await win.webContents.capturePage(undefined,{stayAwake:true})).toPNG());
    const download=new Promise((resolve,reject)=>{win.webContents.session.once('will-download',(_event,item)=>{const filename=path.join(output,'ui-'+width+'-'+item.getFilename());item.setSavePath(filename);item.once('done',(_event,state)=>state==='completed'?resolve(filename):reject(Error('Download '+state)));});setTimeout(()=>reject(Error('UI download timed out')),15000).unref();});
    await win.webContents.executeJavaScript(`([...document.querySelectorAll('[data-testid="document-image-dialog"] button')].find(node=>node.textContent.startsWith('Download'))).click()`);const downloaded=await download;assert(fs.statSync(downloaded).size>0);
    const zip=await require('jszip').loadAsync(fs.readFileSync(downloaded)),manifest=JSON.parse(await zip.file('manifest.json').async('string'));assert.equal(manifest.width,640);assert.equal(manifest.pages.length,3);assert.equal(Object.keys(zip.files).filter(name=>name.endsWith('.png')).length,3);
    await win.webContents.executeJavaScript(`document.querySelector('[role="dialog"] button[aria-label="Close"]').click()`);await new Promise(resolve=>setTimeout(resolve,80));
  }
  console.log(`PASS ${Object.keys(fixture.ids).length*2} native MCP document images, all ${Object.keys(fixture.ids).length} kinds Base/era, complete coverage, final prose pixels, ratio2, deterministic pixels, framed board, owner isolation, immutable sources; normal Library UI/download1440/640`);
};
