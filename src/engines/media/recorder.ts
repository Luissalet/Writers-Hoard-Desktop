import { MAX_MEDIA_BYTES } from './types';

/** User-initiated recording only. Disposal also handles a pending permission prompt. */
export class LocalVoiceRecorder {
  private disposed = false;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private recording: Promise<Blob> | null = null;
  private starting = false;
  async start(): Promise<void> {
    if (this.disposed || this.recorder || this.starting || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('recording_unavailable');
    this.starting = true;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
    finally { this.starting = false; }
    if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    try { this.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch (error) { this.dispose(); throw error; }
    const recorder = this.recorder;
    const chunks: Blob[] = []; let size = 0; let overflow = false;
    this.recording = new Promise((resolve, reject) => {
      recorder.ondataavailable = event => {
        if (event.data?.size) { size += event.data.size; if (size <= MAX_MEDIA_BYTES) chunks.push(event.data); else { overflow = true; if (recorder.state !== 'inactive') recorder.stop(); } }
      };
      recorder.onerror = () => { reject(new Error('recording_failed')); this.stopTracks(); };
      recorder.onstop = () => { this.stopTracks(); if (overflow) reject(new Error('recording_size')); else resolve(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' })); };
    });
    // The UI may unmount before stop; attach a rejection handler immediately.
    void this.recording.catch(() => {});
    recorder.start(1000);
  }
  async stop(): Promise<Blob> {
    if (!this.recorder || !this.recording) throw new Error('not_recording');
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    return this.recording;
  }
  pause(): void { if (this.recorder?.state === 'recording') this.recorder.pause(); }
  resume(): void { if (this.recorder?.state === 'paused') this.recorder.resume(); }
  private stopTracks(): void { this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; }
  dispose(): void { this.disposed = true; if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); this.stopTracks(); }
}
