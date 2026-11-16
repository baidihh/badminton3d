import * as THREE from 'three';
import { PlayerView, shadowTexture } from './player.js';
import { CharacterSlot } from './character-slot.js';

export function mountCharacterShowcase(canvas, { load, onStatus = () => {} }) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0xa7be9a,2.8));
  const sun=new THREE.DirectionalLight(0xfff4de,3);sun.position.set(3,6,2);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-3;sun.shadow.camera.right=3;sun.shadow.camera.top=4;sun.shadow.camera.bottom=-8;sun.shadow.normalBias=.03;scene.add(sun);
  const rim=new THREE.DirectionalLight(0xc6eaf5,1.5);rim.position.set(-3,4,-6);scene.add(rim);
  const platform=new THREE.Mesh(new THREE.CylinderGeometry(1.25,1.33,.12,64),new THREE.MeshStandardMaterial({color:0xe7eddb,roughness:1}));platform.position.set(0,-.09,-4.6);platform.receiveShadow=true;scene.add(platform);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.25,.012,6,64),new THREE.MeshStandardMaterial({color:0xe9986b}));ring.rotation.x=Math.PI/2;ring.position.set(0,-.025,-4.6);scene.add(ring);
  const shadowTex=shadowTexture(),camera=new THREE.PerspectiveCamera(32,1,.1,40);
  const slot=new CharacterSlot({load,create:(asset,character)=>new PlayerView(asset,{character,accent:0x5d9f86,shadowTex}),attach:v=>v.addTo(scene),detach:v=>scene.remove(v.root,v.blob),onStatus});
  let active=true,time=0,last=performance.now(),swingAt=-10,swingId=0,frameId,disposed=false;
  function frame(now){
    if(disposed)return;
    const dt=Math.min((now-last)/1000,.04);last=now;
    if(active){
      time+=dt;const rect=canvas.getBoundingClientRect();
      if(rect.width&&rect.height){
        const ratio=renderer.getPixelRatio();if(canvas.width!==Math.floor(rect.width*ratio)||canvas.height!==Math.floor(rect.height*ratio))renderer.setSize(rect.width,rect.height,false);
        const age=time-swingAt,p={x:0,y:2,z:-4.6,vx:0,vz:0,hand:'right',flash:age<.4?.5:0};
        if(age<.8)p.stroke={id:swingId,age,hit:true,shot:'clear',contact:{x:.2,y:2,z:-4.05}};
        slot.view?.update(dt,p,{x:0,y:2,z:-3.6});
        const angle=.16+Math.sin(time*.32)*.13;
        const distance=rect.width/rect.height<.8?6.9:5.7;
        camera.position.set(Math.sin(angle)*distance,2.15,-4.6+Math.cos(angle)*distance);camera.lookAt(0,1.15,-4.6);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();renderer.render(scene,camera);
      }
    }
    frameId=requestAnimationFrame(frame);
  }
  frameId=requestAnimationFrame(frame);
  return {select:id=>slot.select(id),setActive:value=>{active=value;last=performance.now();},swing:()=>{swingAt=time;swingId++;},dispose(){disposed=true;cancelAnimationFrame(frameId);slot.dispose();renderer.dispose();shadowTex.dispose();platform.geometry.dispose();platform.material.dispose();ring.geometry.dispose();ring.material.dispose();sun.shadow.dispose();}};
}
