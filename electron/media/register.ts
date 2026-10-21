import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { VoiceTranscriptRequest } from '../../src/engines/media/voiceTypes';
import { cancelVoiceTranscript, setupVoice, startVoiceTranscript, voiceStatus, voiceTranscriptStatus } from './voice';
export { configureVoice, closeVoice } from './voice';
export function registerVoiceIpc(assertSender:(event:IpcMainInvokeEvent,channel:string)=>void){
  ipcMain.handle('media:voiceStatus',event=>{assertSender(event,'media:voiceStatus');return voiceStatus();});
  ipcMain.handle('media:setupVoice',event=>{assertSender(event,'media:setupVoice');return setupVoice();});
  ipcMain.handle('media:startVoiceTranscript',(event,request:VoiceTranscriptRequest)=>{assertSender(event,'media:startVoiceTranscript');return startVoiceTranscript(request);});
  ipcMain.handle('media:voiceTranscriptStatus',(event,id:string)=>{assertSender(event,'media:voiceTranscriptStatus');return voiceTranscriptStatus(id);});
  ipcMain.handle('media:cancelVoiceTranscript',(event,id:string)=>{assertSender(event,'media:cancelVoiceTranscript');return cancelVoiceTranscript(id);});
}
