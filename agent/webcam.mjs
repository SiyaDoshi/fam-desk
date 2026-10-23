// Phone camera page, used while the Chert line forwards only the caller's audio.
//   npm run camera   -> starts this page AND a secure public link, then prints the full
//                       link and a QR code. Scan it with the iPhone camera, tap "Show my camera".
//   (npm run webcam  -> the page only, for http://localhost:8090/<code> on this Mac)
// Open the link in Safari on the iPhone that is on the FaceTime call, and allow the camera. The page sends back-camera frames to the agent and
// shows the red circle the agent draws, right on the live camera view.
// It also works in a laptop browser at http://localhost:8090/<code>.
// When the bridge does publish caller video, the agent uses that instead.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.WEBCAM_PORT || 8090);
const CODE = process.env.WEBCAM_CODE || randomBytes(4).toString('hex');   // keeps the public link private
const FILE = fileURLToPath(new URL('./.webcam.jpg', import.meta.url));
const POINTER = fileURLToPath(new URL('./.pointer.jpg', import.meta.url));

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>FamDesk camera</title><style>
html,body{margin:0;height:100%;background:#0b1f2c;color:#eaf6f1;font:18px -apple-system,system-ui,sans-serif}
#wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
video,#ptr{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
#ptr{display:none}
#bar{position:absolute;left:0;right:0;bottom:0;padding:14px 16px calc(14px + env(safe-area-inset-bottom));
  background:rgba(11,31,44,.85);text-align:center}
#start{font:inherit;font-size:20px;padding:14px 22px;border:0;border-radius:14px;background:#8de0c4;color:#0b1f2c;font-weight:600}
</style></head><body><div id="wrap">
<video id="v" autoplay playsinline muted></video><img id="ptr" alt="">
<div id="bar"><div id="msg">FamDesk helper camera</div><p><button id="start">Show my camera</button></p></div>
</div><canvas id="c" style="display:none"></canvas>
<script>
const base=location.pathname.replace(/\\/$/,'');
const v=document.getElementById('v'),c=document.getElementById('c'),ptr=document.getElementById('ptr'),msg=document.getElementById('msg'),btn=document.getElementById('start');
let running=false;
btn.onclick=async()=>{
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
    v.srcObject=stream;btn.remove();running=true;msg.textContent='Point the camera at the device. Keep this page open.';
    tick();poll();
  }catch(e){msg.textContent='Could not open the camera: '+e.message;}
};
async function tick(){
  if(running&&v.videoWidth){
    const s=Math.min(1,960/Math.max(v.videoWidth,v.videoHeight));
    c.width=Math.round(v.videoWidth*s);c.height=Math.round(v.videoHeight*s);
    c.getContext('2d').drawImage(v,0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.8));
    try{await fetch(base+'/frame',{method:'POST',body:blob});}catch{msg.textContent='Lost connection to the helper. Reload the page.';}
  }
  setTimeout(tick,500);
}
let last='';
async function poll(){
  try{
    const r=await fetch(base+'/pointer',{cache:'no-store'});
    if(r.status===200){
      const stamp=r.headers.get('x-stamp')||'';
      if(stamp!==last){last=stamp;ptr.src=URL.createObjectURL(await r.blob());}
      ptr.style.display='block';msg.textContent='Look at the red circle.';
    }else{ptr.style.display='none';if(running)msg.textContent='Point the camera at the device. Keep this page open.';}
  }catch{}
  setTimeout(poll,800);
}
</script></body></html>`;

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const prefix = `/${CODE}`;
  if (!url.pathname.startsWith(prefix)) return res.writeHead(404).end('Not found');
  const route = url.pathname.slice(prefix.length);
  if (req.method === 'POST' && route === '/frame') {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      try { writeFileSync(FILE + '.tmp', Buffer.concat(chunks)); renameSync(FILE + '.tmp', FILE); } catch {}
      res.writeHead(204).end();
    });
    return;
  }
  if (route === '/pointer') {
    try {
      const st = statSync(POINTER);
      if (st.mtimeMs > Date.now()) {   // the agent sets mtime to when the circle should disappear
        return res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-stamp': String(st.size) + '-' + st.ctimeMs })
          .end(readFileSync(POINTER));
      }
    } catch {}
    return res.writeHead(204).end();
  }
  if (route === '' || route === '/') {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(PAGE);
  }
  res.writeHead(404).end('Not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`FamDesk camera page is running (code ${CODE}). On this Mac: http://localhost:${PORT}/${CODE}`);
  if (process.argv.includes('--tunnel')) startTunnel();
});

/** A free Cloudflare quick tunnel (no account): gives the iPhone an https link to this page. */
function startTunnel() {
  console.log('Opening a secure link for the iPhone (takes about 10 seconds)...');
  const child = spawn('npx', ['--yes', 'cloudflared', 'tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let shown = false;
  const scan = async chunk => {
    const match = !shown && String(chunk).match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/);
    if (!match) return;
    shown = true;
    const link = `${match[0]}/${CODE}`;
    console.log('\n======================================================');
    console.log('  iPhone camera link (open in Safari, or scan the QR):');
    console.log(`  ${link}`);
    console.log('======================================================');
    try { (await import('qrcode-terminal')).default.generate(link, { small: true }); } catch {}
    console.log('Keep this window open. If the page does not load at first, wait 10 seconds and reload.\n');
  };
  child.stdout.on('data', scan);
  child.stderr.on('data', scan);
  child.on('error', err => console.warn(`[tunnel] could not start cloudflared (${err.message}). The page still works on this Mac.`));
  child.on('exit', code => console.log(`[tunnel] stopped (${code}). Run npm run camera again for a new link.`));
  const stop = () => { child.kill('SIGTERM'); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
