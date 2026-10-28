import { clipWindow, clipGain } from './cinema.js?v=0.7.1';

// Mix small, absolute-time PCM blocks. Independent clips share decoded source
// buffers but never playback state. Peak protection is an explicit hard limiter.
export function mixStereo(clips, buffers, start, frames, rate = 48000) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (const clip of clips) {
    const buffer = buffers.get(clip.assetId); if (!buffer) continue;
    const {trim,start:clipStart,length} = clipWindow(clip,buffer.duration);
    const a = Math.max(0,Math.ceil((clipStart-start)*rate)), b = Math.min(frames,Math.ceil((clipStart+length-start)*rate));
    if (b<=a) continue;
    const L = buffer.getChannelData(0), R = buffer.numberOfChannels>1 ? buffer.getChannelData(1) : L;
    const pan = Math.max(-1,Math.min(1,Number(clip.pan)||0));
    for(let i=a;i<b;i++) {
      const elapsed = start+i/rate-clipStart, source=(trim+elapsed)*buffer.sampleRate;
      const j=Math.floor(source), u=source-j, gain=clipGain(clip,elapsed,length);
      const l=((L[j]||0)*(1-u)+(L[j+1]||0)*u)*gain, r=((R[j]||0)*(1-u)+(R[j+1]||0)*u)*gain;
      if(buffer.numberOfChannels===1) { const angle=(pan+1)*Math.PI/4;left[i]+=l*Math.cos(angle);right[i]+=l*Math.sin(angle); }
      else if(pan<0) {const angle=(pan+1)*Math.PI/2;left[i]+=l+r*Math.cos(angle);right[i]+=r*Math.sin(angle);}
      else {const angle=pan*Math.PI/2;left[i]+=l*Math.cos(angle);right[i]+=r+l*Math.sin(angle);}
    }
  }
  for(let i=0;i<frames;i++){left[i]=Math.max(-1,Math.min(1,left[i]));right[i]=Math.max(-1,Math.min(1,right[i]));}
  return [left,right];
}
export async function decodeSources(assets, clips, range) {
  const used = new Set(clips.filter(c=>Number(c.start || 0)<range.end &&
    (c.trimDuration>0 ? Number(c.start || 0)+Number(c.trimDuration)>range.start : true)).map(c=>c.assetId));
  const context = new OfflineAudioContext(2,1,48000), buffers = new Map();
  let decodedBytes=0;
  for(const id of used) {
    const asset=assets.find(a=>a.id===id);
    if(!asset?.dataURL) throw new Error('Audio source is missing. Reimport it or remove its clips.');
    const buffer=await context.decodeAudioData(await(await fetch(asset.dataURL)).arrayBuffer());
    decodedBytes+=buffer.length*buffer.numberOfChannels*4;
    if(decodedBytes>256*1024*1024) throw new Error('Decoded audio exceeds 256 MB. Use shorter audio sources or smaller sections.');
    buffers.set(id,buffer);
  }
  return buffers;
}
