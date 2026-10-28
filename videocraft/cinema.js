const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(+v) ? +v : a));
export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'focused'];
export const GRADES = {
  neutral: { contrast:1, saturation:1, temperature:0, vignette:0, grain:0 },
  drama: { contrast:1.12, saturation:0.8, temperature:-0.12, vignette:0.24, grain:0.018 },
  warm: { contrast:1.06, saturation:0.95, temperature:0.3, vignette:0.18, grain:0.012 },
  noir: { contrast:1.3, saturation:0.05, temperature:-0.08, vignette:0.38, grain:0.025 },
  vivid: { contrast:1.08, saturation:1.2, temperature:0.04, vignette:0.1, grain:0 },
};
export const LIGHT_RIGS = {
  portrait: { key:'#ffe1be', intensity:3.6, position:[-4,6,7], rim:'#a5caff', rimIntensity:2.1, rimPosition:[5,4,-5], ambient:0.45 },
  moonlight: { key:'#a0bdff', intensity:2.8, position:[-5,7,2], rim:'#d9edff', rimIntensity:3, rimPosition:[3,5,-6], ambient:0.14 },
  neon: { key:'#ff79bb', intensity:3, position:[-4,3,4], rim:'#4edfff', rimIntensity:4, rimPosition:[4,4,-4], ambient:0.22 },
  golden: { key:'#ffb966', intensity:4, position:[-7,4,5], rim:'#cedaff', rimIntensity:1.7, rimPosition:[4,6,-5], ambient:0.5 },
};
export function gradeSettings(g = {}) {
  return { contrast:clamp(g.contrast ?? 1,0.5,1.8), saturation:clamp(g.saturation ?? 1,0,1.8),
    temperature:clamp(g.temperature ?? 0,-1,1), vignette:clamp(g.vignette ?? 0,0,0.7), grain:clamp(g.grain ?? 0,0,0.08) };
}
export function performanceSettings(p = {}) {
  const voice = p.voice && typeof p.voice.clipId === 'string' && Array.isArray(p.voice.values)
    ? { clipId:p.voice.clipId, step:clamp(p.voice.step ?? 0.02,0.01,0.1),
      values:p.voice.values.slice(0,60001).map(v=>clamp(v,0,1)) } : null;
  return { enabled:p.enabled === true, emotion:EXPRESSIONS.includes(p.emotion) ? p.emotion : 'neutral',
    blink:p.blink !== false, gazeX:clamp(p.gazeX ?? 0,-1,1), gazeY:clamp(p.gazeY ?? 0,-1,1),
    mouth:clamp(p.mouth ?? 0,0,1), voice,
    speech:Array.isArray(p.speech) ? p.speech.slice(0,1000).filter(c=>c && Number.isFinite(+c.start) && +c.end>+c.start)
      .map(c=>({start:Math.max(0,+c.start),end:Math.max(0,+c.end),text:String(c.text || '').slice(0,2000)})) : [] };
}
export function clipWindow(clip, duration) {
  const trim = clamp(clip.trimIn ?? 0,0,duration), start = Number(clip.start) || 0;
  const length = Math.max(0,Math.min(clip.trimDuration > 0 ? +clip.trimDuration : Infinity,duration-trim));
  return { trim, start, length };
}
export function clipGain(clip, elapsed, length) {
  if (elapsed < 0 || elapsed >= length) return 0;
  return clamp(clip.volume ?? 1,0,4) * Math.min(clip.fadeIn>0 ? clamp(elapsed/clip.fadeIn,0,1) : 1,
    clip.fadeOut>0 ? clamp((length-elapsed)/clip.fadeOut,0,1) : 1);
}
export function samplePerformance(p, time, movieTime, clips = [], seed = 0) {
  const emotion = EXPRESSIONS.includes(p?.emotion) ? p.emotion : 'neutral';
  const phase = ((time + seed * 0.017) % 4.3 + 4.3) % 4.3;
  const blink = p?.blink === false ? 0 : Math.max(0,1-Math.abs(phase-3.7)/0.09);
  let mouth = clamp(p?.mouth ?? 0,0,1);
  for (const cue of p?.speech || []) if (time >= cue.start && time < cue.end && /\S/.test(cue.text)) {
    const t = time-cue.start, edge = Math.min(1,t/0.08,(cue.end-time)/0.08);
    mouth = Math.max(mouth,edge*(0.14+0.7*Math.abs(Math.sin(t*12.7))*Math.abs(Math.sin(t*4.1+0.6))));
  }
  if (p?.voice) {
    const clip = clips.find(c=>c.id === p.voice.clipId);
    if (clip) {
      const {trim,start,length} = clipWindow(clip,p.voice.values.length*p.voice.step);
      const elapsed = movieTime-start, source = (trim+elapsed)/p.voice.step;
      if (elapsed>=0 && elapsed<length) {
        const i = Math.floor(source), u = source-i;
        const amp = (p.voice.values[i] || 0)*(1-u)+(p.voice.values[i+1] || 0)*u;
        mouth = Math.max(mouth,amp*Math.min(1,clipGain(clip,elapsed,length)));
      }
    }
  }
  return { emotion, blink, mouth:clamp(mouth,0,1), gazeX:clamp(p?.gazeX ?? 0,-1,1), gazeY:clamp(p?.gazeY ?? 0,-1,1) };
}
export function audioEnvelope(buffer, step = 0.02) {
  if (buffer.duration > 600) throw new Error('Use a dialogue source of ten minutes or less for mouth analysis.');
  const hop = Math.max(1,Math.round(buffer.sampleRate*step)), values = [];
  const channels = Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
  for(let i=0;i<buffer.length;i+=hop) {
    let sum=0, count=0;
    for(const channel of channels) for(let j=i;j<Math.min(i+hop,buffer.length);j++) {sum+=channel[j]*channel[j];count++;}
    const rms = Math.sqrt(sum/Math.max(1,count));
    values.push(Math.round(Math.min(1,Math.max(0,(rms-0.008)*5))*100)/100);
  }
  return {step,values};
}
export function composeCamera(position, height, rotation, kind = 'medium') {
  const target = [position[0],position[1]+height*(kind==='close' ? 0.87 : kind==='wide' ? 0.5 : 0.68),position[2]];
  const distance = height*(kind==='close' ? 0.85 : kind==='wide' ? 3.5 : 1.9);
  const angle = rotation*Math.PI/180 + 0.15;
  return {pos:[target[0]+Math.sin(angle)*distance,target[1]+height*0.06,target[2]+Math.cos(angle)*distance],
    tgt:target,fov:kind==='close' ? 35 : 42};
}
