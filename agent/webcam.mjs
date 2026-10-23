// Stand-in camera while the Chert line does not forward the caller's video.
//   npm run webcam   ->  open http://localhost:8090 in Chrome or Safari and allow the camera
// The page sends a JPEG frame about twice a second; this server saves the latest one to
// .webcam.jpg, and the agent's snapshots read it when no caller video reaches the call.
// When the bridge does publish caller video, the agent uses that instead.
import { createServer } from 'node:http';
import { renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.WEBCAM_PORT || 8090);
const FILE = fileURLToPath(new URL('./.webcam.jpg', import.meta.url));
const TMP = FILE + '.tmp';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FamDesk camera</title><style>
body{margin:0;background:#10283a;color:#eaf6f1;font:16px system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px}
video{max-width:100%;max-height:70vh;border-radius:12px;background:#000}
#s{opacity:.8} select,button{font:inherit;padding:6px 10px;border-radius:8px}
</style></head><body>
<h2 style="margin:0">FamDesk camera</h2>
<div><select id="cams"></select> <button id="flip">Mirror off</button></div>
<video id="v" autoplay playsinline muted></video><div id="s">Starting camera…</div>
<canvas id="c" style="display:none"></canvas>
<script>
const v=document.getElementById('v'),c=document.getElementById('c'),s=document.getElementById('s'),cams=document.getElementById('cams');
let stream,sent=0;
async function start(id){
  if(stream)stream.getTracks().forEach(t=>t.stop());
  stream=await navigator.mediaDevices.getUserMedia({video:id?{deviceId:{exact:id},width:1280}:{width:1280},audio:false});
  v.srcObject=stream;
  const list=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
  cams.innerHTML=list.map(d=>'<option value="'+d.deviceId+'">'+(d.label||'Camera')+'</option>').join('');
  cams.value=stream.getVideoTracks()[0].getSettings().deviceId||'';
}
cams.onchange=()=>start(cams.value);
document.getElementById('flip').onclick=e=>{v.style.transform=v.style.transform?'':'scaleX(-1)';e.target.textContent=v.style.transform?'Mirror on':'Mirror off'};
async function tick(){
  if(v.videoWidth){
    c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.8));
    try{await fetch('/frame',{method:'POST',body:blob});sent++;s.textContent='Sending to the agent ('+sent+' frames). Keep this tab open.';}
    catch{s.textContent='Cannot reach the camera server. Is npm run webcam running?';}
  }
  setTimeout(tick,500);
}
start().then(tick).catch(e=>s.textContent='Camera error: '+e.message);
</script></body></html>`;

createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/frame') {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      try { writeFileSync(TMP, Buffer.concat(chunks)); renameSync(TMP, FILE); } catch {}
      res.writeHead(204).end();
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`FamDesk camera: open http://localhost:${PORT} in Chrome or Safari and allow the camera.`);
});
