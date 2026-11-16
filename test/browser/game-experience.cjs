// NODE_PATH=<bundled browser packages> node test/browser/game-experience.cjs
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.CHARACTER_TEST_URL||'http://localhost:3101/');
  await page.getByRole('button',{name:'开启我的主场',exact:false}).click();
  assert.equal(await page.locator('#gameRoster button').count(),9);
  await page.getByRole('button',{name:'选择星跃',exact:true}).click();
  await page.getByRole('button',{name:'就选这位',exact:false}).click();
  await page.waitForFunction(()=>!document.getElementById('go').disabled);
  await page.getByRole('button',{name:'进入球场',exact:false}).click();
  assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('inLobby')),false);
  await page.getByRole('button',{name:'← 俱乐部',exact:true}).click();
  assert.equal(await page.locator('[data-character="junior-girl"]').getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'就选这位',exact:false}).click();
  await page.locator('[data-mode=duo]').click();await page.locator('[data-control=phone]').click();
  assert.equal(await page.locator('#go').isDisabled(),true);await page.locator('#qrbox svg').waitFor();
  await page.locator('#useKeyboard').click();await page.waitForFunction(()=>!document.getElementById('go').disabled);
  await page.getByRole('button',{name:'进入球场',exact:false}).click();
  assert.ok(await page.locator('#b2').evaluate(e=>e.classList.contains('on')));
  await page.getByRole('button',{name:'← 俱乐部',exact:true}).click();
  await page.locator('#gameRoster').evaluate(e=>{const buttons=[...e.querySelectorAll('button')];for(let i=0;i<24;i++)buttons[i%buttons.length].click();buttons.find(b=>b.dataset.character==='kitten').click();});
  await page.getByRole('button',{name:'就选这位',exact:false}).click();await page.waitForFunction(()=>!document.getElementById('go').disabled);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.getElementById('start').scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'怎么玩？',exact:true}).click();await page.locator('#howToPlay').waitFor({state:'visible'});
  await page.getByRole('button',{name:'明白了，来一球',exact:false}).click();
  assert.deepEqual(errors,[]);console.log('Game experience browser checks passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
