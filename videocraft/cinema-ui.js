import { EXPRESSIONS, GRADES, LIGHT_RIGS, gradeSettings, performanceSettings } from './cinema.js?v=0.7.1';
import { filmField } from './film-ui.js?v=0.7.1';
const make = (tag,text,cls) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function group(parent,title) {const d=make('details',undefined,'studio-details film-details'),body=make('div',undefined,'studio-stack');d.append(make('summary',title),body);parent.append(d);return body;}
function choose(parent,label,value,items,change) {
  const wrap=make('label',undefined,'studio-field'),input=make('select',undefined,'studio-input');
  input.setAttribute('aria-label',label);items.forEach(([value,text])=>{const o=make('option',text);o.value=value;input.append(o);});
  input.value=value;input.onchange=()=>change(input.value);wrap.append(make('span',label,'studio-label'),input);parent.append(wrap);return input;
}
function button(parent,label,click) {const b=make('button',label,'btn');b.onclick=click;parent.append(b);return b;}
export function renderCinemaLook(parent,shot,api) {
  const body=group(parent,'Cinematic lighting & grade'),film=shot.film;
  const changed=()=>{api.look();api.dirty();};
  choose(body,'Cinematic light rig',film.lightRig || 'legacy',[['legacy','Original shot lighting'],...Object.keys(LIGHT_RIGS).map(k=>[k,k])],v=>{film.lightRig=v;changed();});
  choose(body,'Colour grade preset','custom',[['custom','Custom settings'],...Object.keys(GRADES).map(k=>[k,k])],v=>{
    if(!GRADES[v])return;film.grade={...GRADES[v]};changed();draw();
  });
  const controls=make('div',undefined,'studio-stack');body.append(controls);
  const draw=()=>{
    controls.replaceChildren();film.grade=gradeSettings(film.grade);
    for(const [key,label,min,max,step] of [['contrast','Grade contrast',0.5,1.8,0.05],['saturation','Grade saturation',0,1.8,0.05],['temperature','Grade warmth',-1,1,0.05],['vignette','Vignette',0,0.7,0.05],['grain','Film grain',0,0.08,0.005]])
      filmField(controls,label,film.grade[key],v=>{film.grade[key]=Math.max(min,Math.min(max,v));changed();},'number',{min,max,step});
  };draw();
  body.append(make('p','GPU grading is shared by preview and export. Grain is deterministic when scrubbing. Grades do not affect caption colours.','studio-muted'));
}
export function renderPerformance(parent,object,api) {
  if(object.type==='character' && object.rigMode!=='3d')return;
  const body=group(parent,'Face, gaze & dialogue'),p=object.performance ||= performanceSettings();
  const changed=()=>{api.evaluate();api.dirty();};
  if(object.type==='imported') choose(body,'Imported face overrides',p.enabled?'on':'off',[['off','Keep authored morph animation'],['on','Override recognized face morphs']],v=>{p.enabled=v==='on';changed();});
  body.append(make('p',object.type==='imported' ? 'Opt-in support for named jawOpen, mouthOpen, blink and emotion morphs. Other rigs are left unchanged.' :
    'Direct the face independently of body motion. Mouth analysis follows audio loudness, not phonemes.','studio-muted'));
  choose(body,'Facial expression',p.emotion,EXPRESSIONS.map(k=>[k,k]),v=>{p.emotion=v;changed();});
  choose(body,'Natural blinking',p.blink?'on':'off',[['on','On'],['off','Off']],v=>{p.blink=v==='on';changed();});
  for(const [key,label,min,max] of [['gazeX','Gaze horizontal',-1,1],['gazeY','Gaze vertical',-1,1],['mouth','Mouth opening',0,1]])
    filmField(body,label,p[key],v=>{p[key]=Math.max(min,Math.min(max,v));changed();},'number',{min,max,step:0.05});
  const clips=api.project().audioClips,assets=api.project().audioAssets;
  let clipId=p.voice?.clipId || clips[0]?.id;
  choose(body,'Dialogue audio clip',clipId || '',[['','Choose an audio clip'],...clips.map(c=>[c.id,(assets.find(a=>a.id===c.assetId)?.name || 'Missing audio')+' @ '+c.start+'s'])],v=>clipId=v);
  const status=make('p',p.voice ? 'Audio mouth envelope saved in project.' : 'No audio mouth analysis yet.','studio-muted');body.append(status);
  const analyze=button(body,'Analyze dialogue for mouth movement',async()=>{
    analyze.disabled=true;status.textContent='Analyzing dialogue…';
    try {await api.analyze(object,clipId);status.textContent='Audio mouth envelope saved in project.';changed();}
    catch(e){status.textContent=e.message;}finally{analyze.disabled=false;}
  });
  button(body,'Remove audio mouth movement',()=>{p.voice=null;status.textContent='Audio mouth movement removed.';changed();});
  const cues=make('div',undefined,'studio-stack');body.append(cues);
  const drawCues=()=>{
    cues.replaceChildren();
    p.speech.forEach((c,i)=>{
      const row=make('div',undefined,'caption-cue');cues.append(row);
      filmField(row,'Dialogue cue '+(i+1),c.text,v=>{c.text=v.slice(0,2000);changed();},'textarea',{rows:2});
      filmField(row,'Dialogue '+(i+1)+' start',c.start,v=>{c.start=Math.max(0,v);changed();},'number',{min:0,step:0.1});
      filmField(row,'Dialogue '+(i+1)+' end',c.end,v=>{c.end=Math.max(0,v);changed();},'number',{min:0,step:0.1});
      button(row,'Remove dialogue '+(i+1),()=>{p.speech=p.speech.filter(x=>x!==c);changed();drawCues();});
    });
  };
  button(body,'Add timed dialogue gesture',()=>{
    if(p.speech.length>=1000)return;p.speech.push({start:api.time(),end:Math.min(api.time()+2,api.duration()),text:'Speak here'});changed();drawCues();
  });drawCues();
  choose(body,'Actor camera composition','medium',[['close','Close-up'],['medium','Medium shot'],['wide','Wide shot']],v=>composition=v);
  let composition='medium';
  button(body,'Compose camera on this actor',()=>api.compose(object,composition));
}
