import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Vector2 } from 'three';
import { gradeSettings } from './cinema.js?v=0.7.1';

export function createCinemaRenderer(renderer, scene, camera) {
  let composer, gradePass, size = '', vector = new Vector2();
  function initialize() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene,camera));
    gradePass = new ShaderPass({
      uniforms:{tDiffuse:{value:null},contrast:{value:1},saturation:{value:1},temperature:{value:0},vignette:{value:0},grain:{value:0},frame:{value:0}},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform sampler2D tDiffuse;uniform float contrast,saturation,temperature,vignette,grain,frame;varying vec2 vUv;
      void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;
      c*=vec3(1.0+temperature*0.2,1.0,1.0-temperature*0.2);
      float y=dot(c,vec3(0.2126,0.7152,0.0722));c=mix(vec3(y),c,saturation);
      c=max(vec3(0.0),(c-0.18)*contrast+0.18);
      c*=1.0-vignette*smoothstep(0.18,0.7,length(vUv-0.5));
      float n=fract(sin(dot(gl_FragCoord.xy+frame,vec2(12.9898,78.233)))*43758.5453)-0.5;
      c=max(vec3(0.0),c+n*grain);gl_FragColor=vec4(c,1.0);}`,
    });
    composer.addPass(gradePass); composer.addPass(new OutputPass());
  }
  return {
    render(settings,time,fps=30) {
      const grade=gradeSettings(settings);
      if(Object.keys(grade).every(k=>grade[k]===({contrast:1,saturation:1,temperature:0,vignette:0,grain:0})[k])) {renderer.render(scene,camera);return;}
      if(!composer) initialize();
      renderer.getSize(vector); const ratio=renderer.getPixelRatio(), next=`${vector.x}:${vector.y}:${ratio}`;
      if(next!==size){composer.setPixelRatio(ratio);composer.setSize(vector.x,vector.y);size=next;}
      for(const k of Object.keys(grade)) gradePass.uniforms[k].value=grade[k];
      gradePass.uniforms.frame.value=Math.floor(time*fps+0.00001);
      composer.render(0);
    },
  };
}
