// Run: NODE_PATH=<playwright/pngjs package directory> node test/browser/characters.cjs
// Requires a running local server; optional CHARACTER_TEST_URL and CHROME_PATH.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const bluePixels = buffer => {
  const {data} = PNG.sync.read(buffer);let n=0;
  for(let i=0;i<data.length;i+=4)if(data[i+2]>data[i]+22&&data[i+1]>data[i]+10&&data[i+2]<245)n++;
  return n;
};
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:1300,height:1000},deviceScaleFactor:2});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(() => {
      const raf=window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame=fn=>raf(t=>{
        fn(t);
        const canvas=document.getElementById('comparison');
        const gl=canvas?.getContext('webgl2');if(!gl)return;
        const bytes=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
        gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
        let hash=2166136261;for(let i=0;i<bytes.length;i+=4)hash=Math.imul(hash^bytes[i],16777619);
        window.lastPoseHash=hash;
      });
      addEventListener('DOMContentLoaded',()=>document.getElementById('pause').addEventListener('click',()=>{window.poseAtPause=window.lastPoseHash;},true));
    });
    await page.goto((process.env.CHARACTER_TEST_URL || 'http://127.0.0.1:3101')+'/characters.html?left=rabbit-geo&right=rabbit-glb');
    await page.getByText('球员已就位 · 两侧同步预览').waitFor();
    const canvas=page.locator('#comparison');
    assert.ok(bluePixels(await canvas.screenshot())>500,'both rabbit jerseys are visible');
    // Simulate bfcache suspension/resume even when automated Chrome disables bfcache.
    await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await page.getByRole('button',{name:'侧面',exact:true}).click();
    assert.ok(bluePixels(await canvas.screenshot())>500,'bfcache return retains characters');
    await page.getByRole('button',{name:'步法',exact:true}).click();
    await page.waitForTimeout(400);await page.getByRole('button',{name:'暂停',exact:true}).click();
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(()=>window.lastPoseHash),await page.evaluate(()=>window.poseAtPause),'pause preserves the last animation pose');
    const paused=await canvas.screenshot();await page.waitForTimeout(200);
    const nextImage=await canvas.screenshot();
    const left=PNG.sync.read(paused),right=PNG.sync.read(nextImage);let changed=0;for(let i=0;i<left.data.length;i+=4)if(Math.max(Math.abs(left.data[i]-right.data[i]),Math.abs(left.data[i+1]-right.data[i+1]),Math.abs(left.data[i+2]-right.data[i+2]))>4)changed++;
    // Compare decoded pixels, not PNG byte streams whose encoding may differ.
    assert.equal(changed,0,'paused rendered pixels remain stable');
    await page.getByRole('button',{name:'背面',exact:true}).click();
    assert.ok(bluePixels(await canvas.screenshot())>500,'camera still works during pause');
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
    const resizeCount=await page.evaluate(()=>new Promise(resolve=>{let n=0;const observer=new MutationObserver(records=>n+=records.length);observer.observe(document.getElementById('comparison'),{attributes:true,attributeFilter:['width','height']});setTimeout(()=>{observer.disconnect();resolve(n);},150);}));
    assert.equal(resizeCount,0,'settled mobile drawing buffer is not resized each frame');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile has no horizontal overflow');
    assert.deepEqual(errors,[]);console.log('Character browser regression checks passed');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
