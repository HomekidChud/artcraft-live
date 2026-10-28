import { createSet } from './sets.js?v=0.7.0';
import { shotFilm } from './film.js?v=0.7.0';
import { GRADES, performanceSettings, audioEnvelope, composeCamera } from './cinema.js?v=0.7.0';
import { cameraTracks } from './motion.js?v=0.7.0';

export async function loadDemoVoice() {
  const response=await fetch(new URL('./assets/last-signal-voice.mp3',import.meta.url));
  if(!response.ok)throw new Error('The bundled dialogue could not be downloaded.');
  const blob=await response.blob(),bytes=await blob.arrayBuffer();
  const context=new OfflineAudioContext(2,1,48000),buffer=await context.decodeAudioData(bytes);
  const dataURL=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
  });
  return {dataURL,duration:buffer.duration,envelope:audioEnvelope(buffer)};
}
export function buildCinemaDemo({newProject,newShot,newRig,uid},voice) {
  const p=newProject();p.name='The Last Signal';p.exportAspect='2.39:1';p.fps=24;
  p.studio.plan={...p.studio.plan,genre:'Stylised sci-fi drama',
    logline:'In a silent city, two survivors receive a signal just before dawn.',
    synopsis:'A four-shot performance study: establish the room, move in on Naya, hold her close-up, then cut to Ivo’s reaction.',
    script:'INT. APARTMENT - PRE-DAWN\n\nNAYA: We thought the city had gone quiet. Then, just before dawn... the signal came back.\n\nIvo looks up. There is still someone out there.\n\nOriginal stylised demonstration. Dialogue is AI-generated; mouth movement follows amplitude, not phonemes.'};
  p.characters=['Naya','Ivo'].map((name,i)=>{
    const rig=newRig(name);
    Object.assign(rig,{torsoColor:i?'#9d6241':'#315d6b',legsColor:'#252d3b',hairStyle:i?'side':'flat',
      hairColor:i?'#47382d':'#252029',headColor:i?'#b67d5e':'#c78d6c',feetColor:'#242832'});
    rig.armColor=rig.handColor=rig.headColor;return rig;
  });
  const assetId=uid('audio'),clipId=uid('clip');
  p.audioAssets=[{id:assetId,name:'Naya · generated dialogue',dataURL:voice.dataURL,duration:voice.duration}];
  p.audioClips=[{id:clipId,assetId,start:3,volume:1,pan:-0.1,trimIn:0,trimDuration:0,fadeIn:0.03,fadeOut:0.08}];
  const captions=[
    {start:0.4,end:2.6,text:'THE LAST SIGNAL',size:4.5,position:'bottom'},
    {start:3,end:6.6,text:'We thought the city had gone quiet.',size:3.4,position:'bottom'},
    {start:6.6,end:10.45,text:'Then, just before dawn… the signal came back.',size:3.4,position:'bottom'},
  ];
  let start=0;
  p.shots=[['Before dawn',3,'wide'],['Naya · the silence',4,'medium'],['The signal',3,'close'],['Ivo · hope',3,'reaction']].map(([name,duration,kind],i)=>{
    const shot=newShot(name,duration),set=createSet('interior');
    shot.sceneObjects=[set.object];shot.lighting='night';
    shot.film=shotFilm({...set.film,ground:'#4e5359',background:'#1e2935',exposure:0.95,
      lightRig:i===3?'golden':'portrait',grade:GRADES.drama,fadeIn:i===0?0.5:0,fadeOut:i===3?0.75:0,
      captions:captions.filter(c=>c.start<start+duration && c.end>start).map(c=>({...c,id:uid('cue'),color:'#ffffff',
        start:Math.max(0,c.start-start),end:Math.min(duration,c.end-start)}))});
    p.characters.forEach((rig,j)=>{
      shot.sceneObjects.push({id:uid('obj'),name:rig.name,type:'character',assetId:rig.id,rigMode:'3d',color:'#ffffff',
        pos:[j?1:-1,0,1.7],rot:[0,j?-8:8,0],scale:[1,1,1],opacity:1,
        motion:{clip:'idle',speed:0.65,strength:0.5,phase:j*0.7},
        performance:performanceSettings({emotion:j?(i===3?'surprised':'sad'):'focused',gazeX:j?-0.5:0.15,blink:true,
          voice:j?null:{clipId,...voice.envelope}})});
    });
    const actor=shot.sceneObjects[kind==='reaction'?2:1];
    shot.camera=kind==='wide'?{pos:[3.5,2.7,8],tgt:[0,1.3,-1],fov:42}:composeCamera(actor.pos,2.5,actor.rot[1],kind==='reaction'?'close':kind);
    const to={...shot.camera,pos:shot.camera.pos.map((v,k)=>v+(k===2?-0.22:0))};
    shot.keyframes.__camera__=cameraTracks([...shot.camera.pos,...shot.camera.tgt,shot.camera.fov],
      [...to.pos,...to.tgt,to.fov],duration,'ease');
    start+=duration;return shot;
  });
  p.activeShotId=p.shots[0].id;p.sceneObjects=p.shots[0].sceneObjects;p.keyframes=p.shots[0].keyframes;p.duration=p.shots[0].duration;
  return p;
}
