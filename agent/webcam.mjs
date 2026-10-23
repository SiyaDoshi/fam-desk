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
  if (route === '/call') {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(CALL_PAGE);
  }
  if (route === '/token') {
    callToken().then(body => res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body)))
      .catch(err => res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: err.message })));
    return;
  }
  res.writeHead(404).end('Not found');
}).listen(PORT, '127.0.0.1', () => {
  console.log(`FamDesk camera page is running (code ${CODE}). On this Mac: http://localhost:${PORT}/${CODE}`);
  console.log(`Web video call (no FaceTime needed): add /call to the link.`);
  if (process.argv.includes('--tunnel')) startTunnel();
});

/** A LiveKit token for a web video call that dispatches the FamDesk agent into a new room. */
async function callToken() {
  const { AccessToken, RoomConfiguration, RoomAgentDispatch } = await import('livekit-server-sdk');
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
  if (!url || !key || !secret) throw new Error('LiveKit values missing: start this with npm run camera (it reads .env.local)');
  const room = `famdesk-web-${randomBytes(4).toString('hex')}`;
  const token = new AccessToken(key, secret, { identity: `caller-${randomBytes(3).toString('hex')}`, ttl: 3600 });
  token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  token.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: process.env.AGENT_NAME || 'siya-techhelp' })] });
  return { url, token: await token.toJwt(), room };
}

const CALL_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>FamDesk call</title><style>
html,body{margin:0;height:100%;background:#0b1f2c;color:#eaf6f1;font:18px -apple-system,system-ui,sans-serif}
#wrap{position:relative;width:100%;height:100%}
#me,#ptr{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
#ptr{display:none}
#agent{position:absolute;top:calc(12px + env(safe-area-inset-top));right:12px;width:32%;max-width:180px;border-radius:12px;border:2px solid #8de0c4;background:#10283a}
#bar{position:absolute;left:0;right:0;bottom:0;padding:14px 16px calc(14px + env(safe-area-inset-bottom));background:rgba(11,31,44,.85);text-align:center}
button{font:inherit;font-size:20px;padding:14px 22px;border:0;border-radius:14px;background:#8de0c4;color:#0b1f2c;font-weight:600}
#end{background:#ff3b30;color:#fff;display:none}
</style></head><body><div id="wrap">
<video id="me" autoplay playsinline muted></video><img id="ptr" alt=""><video id="agent" autoplay playsinline></video>
<div id="bar"><div id="msg">FamDesk tech helper</div><p><button id="start">Start video call</button> <button id="end">End call</button></p></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/livekit-client@2.15.7/dist/livekit-client.umd.js"></script>
<script>
const base=location.pathname.replace(/\\/call\\/?$/,'');
const msg=document.getElementById('msg'),start=document.getElementById('start'),end=document.getElementById('end'),ptr=document.getElementById('ptr');
let room;
start.onclick=async()=>{
  start.disabled=true;msg.textContent='Connecting…';
  try{
    const {url,token,error}=await (await fetch(base+'/token',{cache:'no-store'})).json();
    if(error)throw new Error(error);
    room=new LivekitClient.Room({adaptiveStream:true,dynacast:true});
    room.on(LivekitClient.RoomEvent.TrackSubscribed,(track)=>{
      if(track.kind==='video')track.attach(document.getElementById('agent'));
      if(track.kind==='audio'){const el=track.attach();el.play&&el.play();document.body.appendChild(el);}
    });
    room.on(LivekitClient.RoomEvent.Disconnected,()=>{msg.textContent='Call ended.';end.style.display='none';});
    await room.connect(url,token);
    await room.localParticipant.setMicrophoneEnabled(true);
    const cam=await LivekitClient.createLocalVideoTrack({facingMode:'environment',resolution:LivekitClient.VideoPresets.h720.resolution});
    await room.localParticipant.publishTrack(cam,{source:LivekitClient.Track.Source.Camera});
    cam.attach(document.getElementById('me'));
    start.style.display='none';end.style.display='inline-block';
    msg.textContent='Connected. Say hello, then point the camera at the device.';
    poll();
  }catch(e){msg.textContent='Could not start the call: '+e.message;start.disabled=false;}
};
end.onclick=()=>room&&room.disconnect();
let last='';
async function poll(){
  try{
    const r=await fetch(base+'/pointer',{cache:'no-store'});
    if(r.status===200){const st=r.headers.get('x-stamp')||'';if(st!==last){last=st;ptr.src=URL.createObjectURL(await r.blob());}ptr.style.display='block';}
    else ptr.style.display='none';
  }catch{}
  if(room&&room.state!=='disconnected')setTimeout(poll,800);
}
</script></body></html>`;

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
    console.log('  Web video call instead of FaceTime (camera + voice):');
    console.log(`  ${link}/call`);
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
