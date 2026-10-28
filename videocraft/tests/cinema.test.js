import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeSettings, performanceSettings, samplePerformance, audioEnvelope, clipWindow, clipGain, composeCamera, GRADES } from '../cinema.js';
import { mixStereo, decodeSources } from '../sound-render.js';
import { shotFilm } from '../film.js';
import { buildCinemaDemo } from '../cinema-demo.js';
const buffer=(channels,rate=10)=>({sampleRate:rate,numberOfChannels:channels.length,length:channels[0].length,duration:channels[0].length/rate,getChannelData:i=>Float32Array.from(channels[i])});
test('legacy films have neutral grades and no changed lighting rig',()=>{
  assert.deepEqual(shotFilm().grade,GRADES.neutral);assert.equal(shotFilm().lightRig,'legacy');
  assert.equal(shotFilm({lightRig:'not-a-rig'}).lightRig,'legacy');
});
test('empty or malformed optional cinematic settings keep safe defaults',()=>{
  assert.deepEqual(gradeSettings(null),GRADES.neutral);
  assert.deepEqual(gradeSettings('invalid'),GRADES.neutral);
  assert.deepEqual(shotFilm(null),shotFilm());
  assert.deepEqual(shotFilm({grade:null}).grade,GRADES.neutral);
  assert.equal(performanceSettings(null).emotion,'neutral');
});
test('grades normalize finite values within render limits',()=>{
  assert.deepEqual(gradeSettings({contrast:100,saturation:-10,temperature:Infinity,vignette:2,grain:1}),
    {contrast:1.8,saturation:0,temperature:-1,vignette:0.7,grain:0.08});
  assert.deepEqual(shotFilm({grade:GRADES.noir,lightRig:'neon'}).grade,GRADES.noir);
});
test('performance data is bounded and imported overrides remain opt-in',()=>{
  const p=performanceSettings({emotion:'unknown',mouth:2,gazeX:-9,voice:{clipId:'a',values:[NaN,-1,2]},speech:[{start:0,end:2,text:'Hi'},{start:2,end:0}]});
  assert.equal(p.enabled,false);assert.equal(p.emotion,'neutral');assert.equal(p.mouth,1);assert.equal(p.gazeX,-1);
  assert.deepEqual(p.voice.values,[0,0,1]);assert.equal(p.speech.length,1);
});
test('facial sampling is deterministic and blinking can be disabled',()=>{
  const p=performanceSettings();const a=samplePerformance(p,3.7,3.7,[],0);
  assert.equal(a.blink,1);samplePerformance(p,10,10);assert.deepEqual(samplePerformance(p,3.7,3.7,[],0),a);
  assert.equal(samplePerformance({...p,blink:false},3.7,3.7).blink,0);
});
test('timed speech gestures respect start and end and silence',()=>{
  const p=performanceSettings({speech:[{start:1,end:3,text:'Hello there'}]});
  assert.equal(samplePerformance(p,0,0).mouth,0);assert.ok(samplePerformance(p,1.5,1.5).mouth>0);
  assert.equal(samplePerformance(p,3,3).mouth,0);
});
test('audio mouth envelopes follow movie clip start, source trim and gain',()=>{
  const p=performanceSettings({voice:{clipId:'voice',step:0.1,values:[0,0,1,1,0,0]}});
  const clip={id:'voice',start:10,trimIn:0.2,trimDuration:0.2,volume:0.5};
  assert.equal(samplePerformance(p,0,9.9,[clip]).mouth,0);
  assert.ok(Math.abs(samplePerformance(p,0,10,[clip]).mouth-0.5)<1e-8);
  assert.equal(samplePerformance(p,0,10.21,[clip]).mouth,0);
});
test('waveform analysis closes the mouth for silence and opens for signal',()=>{
  const result=audioEnvelope(buffer([[0,0,0.25,-0.25]],100),0.02);
  assert.deepEqual(result.values,[0,1]);
  assert.throws(()=>audioEnvelope({duration:601}),/ten minutes/);
});
test('clip trims and fade envelopes handle crop and boundaries',()=>{
  assert.deepEqual(clipWindow({start:3,trimIn:1,trimDuration:10},5),{start:3,trim:1,length:4});
  assert.equal(clipGain({fadeIn:1,fadeOut:1},0.5,3),0.5);assert.equal(clipGain({},-1,3),0);
  assert.equal(clipGain({},3,3),0);
});
test('camera compositions stay finite, face the actor and tighten from wide to close',()=>{
  const close=composeCamera([1,2,3],2,0,'close'),wide=composeCamera([1,2,3],2,0,'wide');
  assert.ok(close.pos.every(Number.isFinite));assert.equal(close.tgt[1],3.74);
  assert.ok(close.pos[2]<wide.pos[2]);assert.equal(close.fov,35);
});
test('offline mono mix respects delayed start and left/right pan',()=>{
  const buffers=new Map([['a',buffer([Array(20).fill(0.5)])]]);
  const [L,R]=mixStereo([{assetId:'a',start:0.5,pan:-1}],buffers,0,10,10);
  assert.deepEqual([...L.slice(0,5)],[0,0,0,0,0]);assert.equal(L[5],0.5);assert.equal(R[5],0);
});
test('repeated-source clips are independent, trimmed and limited',()=>{
  const buffers=new Map([['a',buffer([[0,0.2,0.4,0.6,0.8,1]])]]);
  const [L,R]=mixStereo([{assetId:'a',start:0,trimIn:0.2,trimDuration:0.2,pan:-1},
    {assetId:'a',start:0.1,trimIn:0.4,trimDuration:0.2,pan:1}],buffers,0,5,10);
  assert.ok(Math.abs(L[0]-0.4)<1e-6);assert.ok(Math.abs(R[1]-0.8)<1e-6);assert.ok(Math.abs(L[2])<1e-6);
  const [limited]=mixStereo([{assetId:'a',start:0,volume:4,pan:-1}],buffers,0,6,10);assert.equal(limited[5],1);
});
test('section PCM has the same samples as full-film PCM',()=>{
  const buffers=new Map([['a',buffer([Array.from({length:50},(_,i)=>i/100)])]]);
  const clips=[{assetId:'a',start:0.3,trimIn:0.2,fadeIn:0.4,fadeOut:0.4}];
  const full=mixStereo(clips,buffers,0,30,10),part=mixStereo(clips,buffers,1,10,10);
  assert.deepEqual(part[0],full[0].slice(10,20));assert.deepEqual(part[1],full[1].slice(10,20));
});
test('stereo centered audio preserves its channels',()=>{
  const [L,R]=mixStereo([{assetId:'s',start:0}],new Map([['s',buffer([[0.4,0.4],[0.2,0.2]])]]),0,2,10);
  assert.ok(Math.abs(L[0]-0.4)<1e-6);assert.ok(Math.abs(R[0]-0.2)<1e-6);
});
test('cinematic demo has four independent shots, shared embedded voice and valid camera channels',()=>{
  let id=0;const uid=()=>String(++id);
  const p=buildCinemaDemo({uid,newProject:()=>({studio:{plan:{}}}),newRig:name=>({id:uid(),name}),
    newShot:(name,duration)=>({id:uid(),name,duration,sceneObjects:[],keyframes:{}})},
    {dataURL:'data:audio/mp3;base64,QA',duration:7.4,envelope:{step:0.02,values:[0,1,0]}});
  assert.equal(p.shots.length,4);assert.equal(p.shots.reduce((n,s)=>n+s.duration,0),13);
  assert.equal(p.audioClips[0].start,3);assert.equal(p.audioAssets.length,1);
  for(const shot of p.shots){
    assert.equal(shot.sceneObjects.filter(o=>o.rigMode==='3d').length,2);
    assert.ok(shot.keyframes.__camera__['cam.pz'].length===2);
    assert.ok(shot.film.captions.every(c=>c.start>=0 && c.end<=shot.duration && c.end>c.start));
  }
  p.shots[0].sceneObjects[1].performance.emotion='angry';
  assert.equal(p.shots[1].sceneObjects[1].performance.emotion,'focused');
});
test('audio source decoding rejects missing/corrupt/oversized sources and deduplicates clips',async()=>{
  const previous=globalThis.OfflineAudioContext;let count=0,mode='normal';
  globalThis.OfflineAudioContext=class {
    async decodeAudioData(){
      count++;
      if(mode==='corrupt')throw new Error('Invalid audio');
      return {length:mode==='oversize'?40e6:48000,numberOfChannels:2,duration:1};
    }
  };
  const range={start:0,end:2},clip={assetId:'a',start:0},asset={id:'a',dataURL:'data:audio/wav;base64,AA=='};
  try{
    await assert.rejects(decodeSources([],[clip],range),/missing/);
    mode='corrupt';await assert.rejects(decodeSources([asset],[clip],range),/Invalid audio/);
    mode='oversize';await assert.rejects(decodeSources([asset],[clip],range),/256 MB/);
    mode='normal';count=0;
    const result=await decodeSources([asset],[clip,{...clip,start:1}],range);
    assert.equal(result.size,1);assert.equal(count,1);
    assert.equal((await decodeSources([], [{...clip,start:3}],range)).size,0);
  }finally{
    if(previous===undefined)delete globalThis.OfflineAudioContext;else globalThis.OfflineAudioContext=previous;
  }
});
