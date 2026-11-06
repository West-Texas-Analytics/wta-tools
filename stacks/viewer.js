/* Parcel Stacks 3D viewer. Ported from wta-stacks (wta-shell plugins/stacks/src/wta_stacks/viewer/template.html);
   keep the two in step. start(D) draws the data that WTAStacks.build() returned. */
window.WTAStacksViewer = { start(D) {
'use strict';
const loadingEl=document.getElementById('loading');
if(!window.THREE||!THREE.OrbitControls){loadingEl.textContent='The 3D library did not load.';return false;}
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const U=10, SLAB_FT=80, D2R=Math.PI/180;
const fmtInt=n=>n.toLocaleString('en-US');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const causes=D.causes, fields=D.fields;

document.getElementById('hTitle').textContent=D.title;
document.getElementById('hSub').textContent=`${D.source} · built ${D.built}`;
const stacks=D.stacks.map((s,i)=>{
  const st={...s,id:i,n:s.rows.length,area:s.acres*43560/(U*U)};
  st.sameOwner=s.rows.every(r=>(r.Owner||'')===(s.rows[0].Owner||''));
  const f=s.rows[0]; st.short=String(f.Legal||f.Situs||f['Geo ID']||'').slice(0,34);
  return st;
});

// ---------- scene ----------
const view=document.getElementById('view');
const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
view.prepend(renderer.domElement);
renderer.domElement.tabIndex=0; renderer.domElement.setAttribute('aria-label','3D parcel view');
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(40,1,1,1e6); camera.up.set(0,0,1);
scene.add(new THREE.AmbientLight(0xffffff,0.62));
const sun=new THREE.DirectionalLight(0xffffff,0.55); sun.position.set(-1,-1.6,2.4); scene.add(sun);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const v2=p=>new THREE.Vector2(p[0],p[1]);

let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
const gpos=[],lpos=[];
D.ground.forEach(polys=>polys.forEach(rings=>{
  if(!rings.length||rings[0].length<3) return;
  const contour=rings[0].map(v2), holes=rings.slice(1).filter(h=>h.length>=3).map(h=>h.map(v2));
  const pts=contour.concat(...holes);
  let tris=[]; try{tris=THREE.ShapeUtils.triangulateShape(contour,holes);}catch(e){}
  tris.forEach(t=>t.forEach(k=>gpos.push(pts[k].x,pts[k].y,0)));
  rings.forEach(r=>{for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];lpos.push(a[0],a[1],0.05,b[0],b[1],0.05);
    if(a[0]<minX)minX=a[0]; if(a[0]>maxX)maxX=a[0]; if(a[1]<minY)minY=a[1]; if(a[1]>maxY)maxY=a[1];}});
}));
if(!isFinite(minX)){minX=minY=-100;maxX=maxY=100;}
const gGeo=new THREE.BufferGeometry(); gGeo.setAttribute('position',new THREE.Float32BufferAttribute(gpos,3));
const gMat=new THREE.MeshBasicMaterial({color:0xe8dcc4}); scene.add(new THREE.Mesh(gGeo,gMat));
const lGeo=new THREE.BufferGeometry(); lGeo.setAttribute('position',new THREE.Float32BufferAttribute(lpos,3));
const lMat=new THREE.LineBasicMaterial({color:0xb9a887}); scene.add(new THREE.LineSegments(lGeo,lMat));
const county={cx:(minX+maxX)/2,cy:(minY+maxY)/2,r:Math.max(maxX-minX,maxY-minY,200)/2};
function applyTheme(){scene.background=new THREE.Color(css('--scene-bg')||'#EFE6D3');gMat.color.set(css('--scene-ground')||'#E8DCC4');lMat.color.set(css('--scene-line')||'#B9A887');}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);

// ---------- color-by ----------
const ramp=["#F1D9A8","#E3A869","#C9713E","#9C4528","#6B2618"];
const cats=["#4F7A8C","#D98A3D","#6E8B3D","#7A5C99","#C8553D","#2E6F8E","#B08D57","#5D6B78","#A3496B","#8C7A5B"];
function rampColor(t){t=Math.max(0,Math.min(1,t));const k=t*(ramp.length-1),i=Math.floor(k),f=k-i;return new THREE.Color(ramp[i]).lerp(new THREE.Color(ramp[Math.min(i+1,ramp.length-1)]),f);}
const maxN=Math.max(2,...stacks.map(s=>s.n));
const colorBy=document.getElementById('colorBy');
const builtins=[['cause','Likely cause'],['owner','Owners match?'],['size','Stack height (rows)'],['match','Exact or after cleanup']];
colorBy.innerHTML=builtins.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')+D.color_fields.map((f,i)=>`<option value="f${i}">${esc(f.key)} (each row)</option>`).join('');
const GREY='#9AA0A6';
function colorFor(s,r){
  const m=colorBy.value;
  if(m==='cause') return new THREE.Color(causes[s.cause].color);
  if(m==='owner') return new THREE.Color(s.sameOwner?'#4F7A8C':'#D98A3D');
  if(m==='match') return new THREE.Color(s.exact?'#4F7A8C':'#D98A3D');
  if(m==='size') return rampColor(maxN>2?Math.log(s.n-1)/Math.log(maxN-1):0);
  const f=D.color_fields[+m.slice(1)], v=r[f.key];
  if(f.type==='num'){ if(!(v>0)) return new THREE.Color(GREY); const lo=Math.log10(f.min),hi=Math.log10(f.max); return rampColor(hi>lo?(Math.log10(v)-lo)/(hi-lo):0.5); }
  const k=f.values.indexOf(String(v)); return new THREE.Color(v==null||v===''?GREY:(k<0?'#8A8A8A':cats[k%cats.length]));
}
function legend(){
  const m=colorBy.value, el=document.getElementById('legend');
  const sw=(c,t)=>`<div><span class="sw" style="background:${c}"></span>${t}</div>`;
  const rampHtml=(a,b,note)=>`<div class="ramp" style="background:linear-gradient(90deg,${ramp.join(',')})"></div><div class="ramp-l"><span>${a}</span><span>${b}</span></div>${note?`<div class="note" style="margin:2px 0 0">${note}</div>`:''}`;
  if(m==='cause') el.innerHTML=Object.entries(causes).filter(([k])=>stacks.some(s=>s.cause===k)).map(([k,c])=>sw(c.color,`${c.label} · ${c.kind==='bad'?'probable error':'often valid'} <span style="color:var(--ink-2)">(${stacks.filter(s=>s.cause===k).length})</span>`)).join('');
  else if(m==='owner') el.innerHTML=sw('#4F7A8C','Same owner on every row')+sw('#D98A3D','Owners differ');
  else if(m==='match') el.innerHTML=sw('#4F7A8C','Exact match (identical geometry)')+sw('#D98A3D','Matched after cleanup');
  else if(m==='size') el.innerHTML=rampHtml('2 rows',maxN+' rows','log scale');
  else{const f=D.color_fields[+m.slice(1)];
    if(f.type==='num') el.innerHTML=rampHtml(Number(f.min).toLocaleString('en-US',{maximumFractionDigits:2}),Number(f.max).toLocaleString('en-US',{maximumFractionDigits:0}),'log scale · grey = blank');
    else el.innerHTML=f.values.map((v,k)=>sw(cats[k%cats.length],esc(v))).join('')+(f.other?sw('#8A8A8A','Other'):'')+sw(GREY,'Blank');}
}

// ---------- account labels: text atlases ----------
const CW=256,CH=32,AW=2048,AH=2048,PER=(AW/CW)*(AH/CH);
const atlases=[]; let used=PER;
function newAtlas(){const c=document.createElement('canvas');c.width=AW;c.height=AH;const g=c.getContext('2d');
  g.font='700 21px Roboto, "Segoe UI", sans-serif';g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';g.lineWidth=4;g.strokeStyle='rgba(20,30,40,.9)';g.fillStyle='#FFFCF4';
  const tex=new THREE.CanvasTexture(c);tex.anisotropy=4;atlases.push({c,g,tex});used=0;}
stacks.forEach(s=>{
  if(used+s.n>PER) newAtlas();
  s.atlas=atlases.length-1;
  s.cells=s.rows.map(r=>{const k=used++, col=k%(AW/CW), row=Math.floor(k/(AW/CW)); const A=atlases[s.atlas];
    const txt=String(r.Account).slice(0,18);
    if(k<PER){A.g.strokeText(txt,col*CW+CW/2,row*CH+CH/2+1); A.g.fillText(txt,col*CW+CW/2,row*CH+CH/2+1);}
    return [col*CW/AW,1-(row+1)*CH/AH,(col+1)*CW/AW,1-row*CH/AH];});
});
atlases.forEach(a=>a.tex.needsUpdate=true);

// ---------- slabs: one merged mesh per stack ----------
const slabGroup=new THREE.Group(); scene.add(slabGroup);
const autoT=document.getElementById('autoT'), minN=document.getElementById('minN');
minN.max=Math.max(3,Math.min(20,maxN));
let selected=null, hoverRow=null, detailRow=null;
function slabT(s){const base=SLAB_FT/U; return autoT.checked? base*Math.min(4,Math.max(1,Math.sqrt(s.area)/14)) : base;}
function shapesOf(polys){return polys.filter(r=>r[0]&&r[0].length>=3).map(rings=>{const sh=new THREE.Shape(rings[0].map(v2));rings.slice(1).forEach(h=>sh.holes.push(new THREE.Path(h.map(v2))));return sh;});}
function labelQuads(s,pos,uv){
  const t=s.t, edges=[];
  s.polys.forEach(rings=>{const r=rings[0]||[];for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L>0.8)edges.push({a,b,L});}});
  edges.sort((x,y)=>y.L-x.L); const pickE=edges.slice(0,6);
  s.rows.forEach((row,i)=>{
    const [u0,v0,u1,v1]=s.cells[i], zc=s.base[i]+t/2;
    pickE.forEach(({a,b,L})=>{
      const ux=(b[0]-a[0])/L, uy=(b[1]-a[1])/L, nx=uy, ny=-ux, o=0.25;
      const mx=(a[0]+b[0])/2+nx*o, my=(a[1]+b[1])/2+ny*o;
      // text runs along the edge, or up the wall when the face is narrow
      let P;
      if(L>=t){const W=Math.min(L*0.88,t*0.8*8), H=W/8; P=(sx,ty)=>[mx+ux*(sx-0.5)*W, my+uy*(sx-0.5)*W, zc+(ty-0.5)*H];}
      else{const W=Math.min(t*0.9,L*0.9*8), H=W/8; P=(sx,ty)=>[mx+ux*(0.5-ty)*H, my+uy*(0.5-ty)*H, zc+(sx-0.5)*W];}
      const c00=P(0,0),c10=P(1,0),c11=P(1,1),c01=P(0,1);
      const uvs={c00:[u0,v0],c10:[u1,v0],c11:[u1,v1],c01:[u0,v1]};
      const e1=[c10[0]-c00[0],c10[1]-c00[1],c10[2]-c00[2]], e2=[c11[0]-c00[0],c11[1]-c00[1],c11[2]-c00[2]];
      const out=(e1[1]*e2[2]-e1[2]*e2[1])*nx+(e1[2]*e2[0]-e1[0]*e2[2])*ny>0;   // keep the face pointing outward
      const tri=out?[[c00,'c00'],[c10,'c10'],[c11,'c11'],[c00,'c00'],[c11,'c11'],[c01,'c01']]:[[c00,'c00'],[c11,'c11'],[c10,'c10'],[c00,'c00'],[c01,'c01'],[c11,'c11']];
      tri.forEach(([p,k])=>{pos.push(p[0],p[1],p[2]);uv.push(...uvs[k]);});
    });
  });
}
function buildStack(s){
  const t=slabT(s), gap=t*0.25; s.t=t; s.base=s.rows.map((_,i)=>0.6+i*(t+gap)); s.top=0.6+s.n*(t+gap);
  const one=new THREE.ExtrudeGeometry(shapesOf(s.polys),{depth:t,bevelEnabled:false});
  const g1=one.index?one.toNonIndexed():one;
  const P=g1.attributes.position.array, Nn=g1.attributes.normal.array, vc=P.length/3; s.vc=vc; s.trisPer=Math.max(1,vc/3);
  const pos=new Float32Array(P.length*s.n), nor=new Float32Array(P.length*s.n), col=new Float32Array(P.length*s.n);
  for(let i=0;i<s.n;i++){const z=s.base[i], off=i*P.length; for(let j=0;j<P.length;j+=3){pos[off+j]=P[j];pos[off+j+1]=P[j+1];pos[off+j+2]=P[j+2]+z;nor[off+j]=Nn[j];nor[off+j+1]=Nn[j+1];nor[off+j+2]=Nn[j+2];}}
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); geo.setAttribute('normal',new THREE.BufferAttribute(nor,3)); geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  const mesh=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,transparent:true})); mesh.userData={s};
  const eg=new THREE.EdgesGeometry(one), EP=eg.attributes.position.array; s.edgeOne=EP;
  const epos=new Float32Array(EP.length*s.n);
  for(let i=0;i<s.n;i++){const z=s.base[i],off=i*EP.length; for(let j=0;j<EP.length;j+=3){epos[off+j]=EP[j];epos[off+j+1]=EP[j+1];epos[off+j+2]=EP[j+2]+z;}}
  const eGeo=new THREE.BufferGeometry(); eGeo.setAttribute('position',new THREE.BufferAttribute(epos,3));
  const edges=new THREE.LineSegments(eGeo,new THREE.LineBasicMaterial({color:0x1A2A37,transparent:true,opacity:0.45}));
  const lp=[],lu=[]; labelQuads(s,lp,lu);
  const lg=new THREE.BufferGeometry(); lg.setAttribute('position',new THREE.Float32BufferAttribute(lp,3)); lg.setAttribute('uv',new THREE.Float32BufferAttribute(lu,2));
  const labels=new THREE.Mesh(lg,new THREE.MeshBasicMaterial({map:atlases[s.atlas].tex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-8}));
  [eg,one,g1].forEach(g=>g.dispose());
  s.obj={mesh,edges,labels}; slabGroup.add(mesh,edges,labels);
  paintStack(s);
}
const PICK=new THREE.Color('#FFD84A'), WASH=new THREE.Color('#FFFFFF');
let paintedPick=null;   // the stack whose clicked slab is drawn highlighted
function paintStack(s){
  const col=s.obj.mesh.geometry.attributes.color, a=col.array;
  const pick=s===selected&&detailRow!=null?detailRow:null;
  s.rows.forEach((r,i)=>{const c=pick==null?colorFor(s,r):i===pick?PICK:colorFor(s,r).clone().lerp(WASH,0.6);for(let j=i*s.vc;j<(i+1)*s.vc;j++){a[j*3]=c.r;a[j*3+1]=c.g;a[j*3+2]=c.b;}});
  col.needsUpdate=true;
}
// beacons: pins over small footprints so town-lot stacks stay findable at county zoom
const BH=260;
let beaconLines=null, beaconBalls=null, beaconStacks=[];
function buildBeacons(){
  if(beaconLines){scene.remove(beaconLines,beaconBalls);beaconLines.geometry.dispose();beaconBalls.geometry.dispose();}
  beaconStacks=stacks.filter(s=>Math.sqrt(s.area)<40);
  const lp=[], lc=[];
  beaconBalls=new THREE.InstancedMesh(new THREE.SphereGeometry(9,12,8),new THREE.MeshLambertMaterial({transparent:true}),Math.max(1,beaconStacks.length));
  beaconBalls.count=beaconStacks.length;
  beaconStacks.forEach(s=>{lp.push(s.cx,s.cy,s.top,s.cx,s.cy,s.top+BH); lc.push(0,0,0,0,0,0);});
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(lp,3)); g.setAttribute('color',new THREE.Float32BufferAttribute(lc,3));
  beaconLines=new THREE.LineSegments(g,new THREE.LineBasicMaterial({vertexColors:true,transparent:true}));
  scene.add(beaconLines,beaconBalls); paintBeacons();
}
function paintBeacons(){
  const c=beaconLines.geometry.attributes.color, p=beaconLines.geometry.attributes.position, m=new THREE.Matrix4();
  beaconStacks.forEach((s,k)=>{const col=colorFor(s,s.rows[0]); beaconBalls.setColorAt(k,col);
    for(let j=0;j<2;j++){c.array[(k*2+j)*3]=col.r;c.array[(k*2+j)*3+1]=col.g;c.array[(k*2+j)*3+2]=col.b;}
    const vis=s.visible?1:0; m.makeTranslation(s.cx,s.cy,s.top+BH).scale(new THREE.Vector3(vis,vis,vis)); beaconBalls.setMatrixAt(k,m);
    p.array[(k*2+1)*3+2]=s.visible? s.top+BH : s.top;});
  p.needsUpdate=true; c.needsUpdate=true; beaconBalls.instanceMatrix.needsUpdate=true; if(beaconBalls.instanceColor) beaconBalls.instanceColor.needsUpdate=true;
}
function buildAll(){
  stacks.forEach(s=>{if(s.obj){Object.values(s.obj).forEach(o=>{o.geometry.dispose();o.material.dispose();});}});
  slabGroup.clear(); stacks.forEach(buildStack); applyVisibility(); buildBeacons(); restyle();
}
function applyVisibility(){stacks.forEach(s=>{s.visible=passes(s); Object.values(s.obj).forEach(o=>o.visible=s.visible);});}
const hl=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x1A2A37})); hl.renderOrder=5; scene.add(hl);
function restyle(){
  stacks.forEach(s=>{const dim=selected&&selected!==s; const o=s.obj;
    o.mesh.material.opacity=dim?0.25:1; o.mesh.material.depthWrite=!dim;
    o.edges.material.opacity=dim?0.12:0.45; o.labels.material.opacity=dim?0.2:1;});
  beaconBalls.material.opacity=beaconLines.material.opacity=selected?0.2:1;
  const want=selected&&detailRow!=null?selected:null;
  if(paintedPick&&paintedPick!==want) paintStack(paintedPick);
  if(want) paintStack(want); paintedPick=want;
  const hr=hoverRow!=null?hoverRow:detailRow;
  if(selected&&hr!=null){const s=selected,EP=s.edgeOne,z=s.base[hr],a=new Float32Array(EP.length);for(let j=0;j<EP.length;j+=3){a[j]=EP[j];a[j+1]=EP[j+1];a[j+2]=EP[j+2]+z;}
    hl.geometry.dispose(); hl.geometry=new THREE.BufferGeometry(); hl.geometry.setAttribute('position',new THREE.BufferAttribute(a,3)); hl.visible=true;}
  else hl.visible=false;
}

// ---------- camera control ----------
const ray=new THREE.Raycaster(), ndc=new THREE.Vector2(), groundPlane=new THREE.Plane(new THREE.Vector3(0,0,1),0);
const MAXD=county.r*4, MIND=8;
function setNDC(e){const r=renderer.domElement.getBoundingClientRect();ndc.set(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);}
function groundAt(e){setNDC(e);ray.setFromCamera(ndc,camera);const p=new THREE.Vector3();return ray.ray.intersectPlane(groundPlane,p)?p:null;}
renderer.domElement.addEventListener('wheel',e=>{
  e.preventDefault(); e.stopImmediatePropagation(); stopAnim();
  // With a stack selected, zoom straight in and out on it so it stays the center of orbit; otherwise zoom toward the cursor.
  const p=selected?controls.target.clone():(groundAt(e)||controls.target.clone()); const f=Math.pow(1.0015,e.deltaY);
  const d=camera.position.distanceTo(controls.target);
  const nf=(d*f<MIND)?MIND/d:(d*f>MAXD?MAXD/d:f);
  camera.position.sub(p).multiplyScalar(nf).add(p); controls.target.sub(p).multiplyScalar(nf).add(p);
},{passive:false});
const controls=new THREE.OrbitControls(camera,renderer.domElement);
controls.enableDamping=true; controls.dampingFactor=0.09; controls.screenSpacePanning=false;
controls.maxPolarAngle=84*D2R; controls.minDistance=MIND; controls.maxDistance=MAXD;
controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
controls.addEventListener('start',stopAnim);
function sph(){const o=camera.position.clone().sub(controls.target);const d=o.length();return {d,phi:Math.acos(Math.min(1,Math.max(-1,o.z/d))),th:Math.atan2(o.y,o.x)};}
function placeCam(t,d,phi,th){camera.position.set(t.x+d*Math.sin(phi)*Math.cos(th),t.y+d*Math.sin(phi)*Math.sin(th),t.z+d*Math.cos(phi));controls.target.copy(t);}
let anim=null; function stopAnim(){anim=null;}
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
function flyTo(t,d,phi,th,ms=1200){
  const a=sph(), from={t:controls.target.clone(),...a};
  if(th===undefined)th=a.th; if(phi===undefined)phi=a.phi; if(d===undefined)d=a.d;
  let dth=th-from.th; while(dth>Math.PI)dth-=2*Math.PI; while(dth<-Math.PI)dth+=2*Math.PI;
  if(reduce){placeCam(t,d,phi,th);return;}
  const t0=performance.now(), far=from.t.distanceTo(t), lift=Math.min(2.2,1+far/Math.max(d,1)*0.05);
  anim=now=>{const k=Math.min(1,(now-t0)/ms),e=ease(k);
    placeCam(from.t.clone().lerp(t,e),(from.d+(d-from.d)*e)*(1+(lift-1)*Math.sin(Math.PI*k)),from.phi+(phi-from.phi)*e,from.th+dth*e); if(k>=1)anim=null;};
}
function fit(){flyTo(new THREE.Vector3(county.cx,county.cy,0),county.r*2.4,45*D2R,-Math.PI/2);}

// ---------- selection + inspector ----------
const fmt=(k,v)=>v==null||v===''?'—':typeof v==='number'?v.toLocaleString('en-US',{maximumFractionDigits:3}):String(v);
function focusStack(s){
  selected=s; hoverRow=null; detailRow=null; restyle(); renderInspector(); renderList();
  // Frame the whole stack, top slab included, however tall it is.
  const side=Math.sqrt(s.area), h=s.top, P=62*D2R, tanH=Math.tan(20*D2R);
  const tall=h*Math.sin(P)+side*Math.cos(P), wide=side*1.2/Math.max(0.5,camera.aspect);
  const d=Math.min(MAXD,Math.max(55,side*3,1.3*Math.max(tall,wide)/2/tanH));
  flyTo(new THREE.Vector3(s.cx,s.cy,h*0.5),d,P);
}
function flyToRow(s,i){hoverRow=i;showSlab(s,i);const r=Math.sqrt(s.area)*0.9;flyTo(new THREE.Vector3(s.cx,s.cy,s.base[i]+s.t/2),Math.max(45,r*2.4,s.t*7),70*D2R,undefined,800);}
function clearSel(){selected=null;hoverRow=null;detailRow=null;restyle();renderInspector();renderList();}
function showSlab(s,i){selected=s; detailRow=i; restyle(); renderInspector(); renderList();}
function backToRows(){detailRow=null;hoverRow=null;restyle();renderInspector();}
// ---------- left panel, below the row slider: the stack list, a stack's rows, or every field of one slab ----------
const insp=document.getElementById('insp');
function renderInspector(){
  if(!selected){
    const vis=stacks.filter(s=>s.visible);
    insp.innerHTML=`<div class="row" style="margin-bottom:6px"><span class="lbl" style="margin:0">Stacks · ${fmtInt(vis.length)} shown</span>
        <span class="btns"><button class="btn" id="prev" title="Previous stack (P)">‹ Prev</button><button class="btn" id="next" title="Next stack (N)">Next ›</button></span></div>
      <div class="stacklist" id="list">${vis.map(s=>`<button data-id="${s.id}"><span class="n">${s.n}</span><span class="t">${esc(causes[s.cause].label)} <small>· ${esc(s.short)}</small></span></button>`).join('')||'<div class="note">No stacks match the filters.</div>'}</div>
      <div class="note">Click a stack here or in the view to see its rows. Click a slab to see everything in that row.</div>`;
    insp.querySelectorAll('#list button').forEach(b=>b.onclick=()=>focusStack(stacks[+b.dataset.id]));
    insp.querySelector('#prev').onclick=()=>step(-1); insp.querySelector('#next').onclick=()=>step(1);
    return;
  }
  const s=selected,c=causes[s.cause];
  const differ=fields.filter(f=>new Set(s.rows.map(r=>String(r[f]??''))).size>1), same=fields.filter(f=>!differ.includes(f));
  const head=`<div class="card-row"><button class="btn" id="iAll">‹ All stacks</button>
      <span class="btns" style="margin-left:auto"><button class="btn" id="prev" title="Previous stack (P)">‹ Prev</button><button class="btn" id="next" title="Next stack (N)">Next ›</button></span></div>
    <div><h3 class="insp-h">${s.n} rows on one footprint</h3>
      <div class="pills"><span class="pill ${c.kind}">${esc(c.label)}</span><span class="pill">${s.exact?'Exact match':'Matched after cleanup'}</span><span class="pill">${s.acres.toLocaleString('en-US')} ac shape</span></div></div>`;
  let body;
  if(detailRow!=null){
    const i=detailRow, r=s.rows[i], rec=(s.recs||[])[i]||{}, cols=D.columns||[];
    const others=cols.filter(k=>rec[k]!=null&&rec[k]!=='');
    body=`<div class="card-row"><button class="btn" id="iBack">‹ All ${s.n} rows</button><span class="card-sub">Slab ${i+1} of ${s.n} · bottom is 1</span></div>
      <dl class="kv">${fields.map(f=>`<dt>${esc(f)}</dt><dd class="${differ.includes(f)?'diff':''}">${esc(fmt(f,r[f]))}</dd>`).join('')}</dl>
      ${others.length?`<details class="card-more"><summary>All ${others.length} filled columns in the file</summary><dl class="kv">${others.map(k=>`<dt>${esc(k)}</dt><dd>${esc(fmt(k,rec[k]))}</dd>`).join('')}</dl></details>`:''}
      <div class="card-nav"><button class="btn" id="iDn" ${i===0?'disabled':''}>▼ Slab below</button><button class="btn" id="iUp" ${i===s.n-1?'disabled':''}>▲ Slab above</button></div>`;
  }else{
    body=`<div><span class="lbl">Rows, bottom slab first · click one for all its data</span><div class="tbl"><table><thead><tr><th>#</th>${differ.map(f=>`<th>${esc(f)}</th>`).join('')}</tr></thead><tbody>
      ${s.rows.map((r,i)=>`<tr data-i="${i}" class="${hoverRow===i?'hl':''}"><td>${i+1}</td>${differ.map(f=>`<td class="diff">${esc(fmt(f,r[f]))}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>
      <div class="same"><b>Same on every row:</b> ${same.map(f=>`${esc(f)} <span style="color:var(--ink)">${esc(fmt(f,s.rows[0][f]))}</span>`).join(' · ')||'none'}</div>
      <div class="btns"><button class="btn" id="iZoom">Zoom to stack</button><button class="btn" id="iClear">Back to county</button></div>`;
  }
  insp.innerHTML=head+body;
  insp.querySelector('#iAll').onclick=clearSel;
  insp.querySelector('#prev').onclick=()=>step(-1); insp.querySelector('#next').onclick=()=>step(1);
  if(detailRow!=null){
    insp.querySelector('#iBack').onclick=backToRows;
    insp.querySelector('#iDn').onclick=()=>flyToRow(s,detailRow-1);
    insp.querySelector('#iUp').onclick=()=>flyToRow(s,detailRow+1);
  }else{
    insp.querySelectorAll('tbody tr').forEach(tr=>{const i=+tr.dataset.i;
      tr.addEventListener('mouseenter',()=>{hoverRow=i;restyle();}); tr.addEventListener('mouseleave',()=>{hoverRow=null;restyle();});
      tr.addEventListener('click',()=>flyToRow(s,i));});
    insp.querySelector('#iZoom').onclick=()=>focusStack(s);
    insp.querySelector('#iClear').onclick=()=>{clearSel();fit();};
  }
}
// ---------- filters (the bar above the view) ----------
const fCause=document.getElementById('fCause'), fUse=document.getElementById('fUse'), fFind=document.getElementById('find');
const useOf=r=>String(r['Land use']??'').trim().toUpperCase();
fCause.innerHTML=`<option value="">All causes</option>`+Object.entries(causes).filter(([k])=>stacks.some(s=>s.cause===k)).map(([k,c])=>`<option value="${esc(k)}">${esc(c.label)}</option>`).join('')+`<option value="!bad">Probable errors only</option>`;
const uses=[...new Set(stacks.flatMap(s=>s.rows.map(useOf)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
fUse.innerHTML=`<option value="">All state codes</option>`+uses.map(u=>`<option>${esc(u)}</option>`).join('');
fUse.disabled=!uses.length; if(!uses.length) fUse.title='No state code / land use column in this file';
function passes(s){
  if(s.n<+minN.value) return false;
  const c=fCause.value; if(c==='!bad'?causes[s.cause].kind!=='bad':c&&s.cause!==c) return false;
  const u=fUse.value; if(u&&!s.rows.some(r=>useOf(r)===u)) return false;
  const q=fFind.value.trim().toUpperCase(); if(q.length>=2&&!s.rows.some(r=>String(r.Account||'').toUpperCase().includes(q)||String(r.Owner||'').toUpperCase().includes(q))) return false;
  return true;
}
function filtersChanged(){applyVisibility();paintBeacons();if(selected&&!selected.visible)clearSel();else{renderList();if(!selected)renderInspector();}}
// Reset: back to how the view looked when it was built.
function resetView(){
  minN.value=minN.min; document.getElementById('minNv').textContent=minN.value; fCause.value=''; fUse.value=''; fFind.value='';
  applyVisibility(); paintBeacons(); clearSel(); fit();
}
function renderList(){
  const vis=stacks.filter(s=>s.visible);
  const rows=vis.reduce((a,s)=>a+s.n,0), bad=vis.filter(s=>causes[s.cause].kind==='bad').length;
  document.getElementById('stats').innerHTML=`<div><b>${fmtInt(vis.length)}</b>stacks</div><div><b>${fmtInt(rows)}</b>rows in stacks</div><div><b>${fmtInt(bad)}</b>probable errors</div><div><b>${fmtInt(D.parcels)}</b>parcels</div>`;
  if(!selected){const L=insp.querySelector('#list'); if(L) L.querySelectorAll('button').forEach(b=>b.classList.remove('on'));}
}
function step(dir){const vis=stacks.filter(s=>s.visible);if(!vis.length)return;let i=selected?vis.indexOf(selected):-1;i=(i+dir+vis.length)%vis.length;focusStack(vis[i]);}

// ---------- pointer ----------
const tip=document.getElementById('tip'); let down=null, hoverQueued=null;
renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};renderer.domElement.focus({preventScroll:true});});
function hitSlab(e){
  setNDC(e); ray.setFromCamera(ndc,camera);
  const objs=stacks.filter(s=>s.visible).map(s=>s.obj.mesh); if(beaconStacks.length) objs.push(beaconBalls);
  for(const x of ray.intersectObjects(objs,false)){
    if(x.object===beaconBalls){const s=beaconStacks[x.instanceId]; if(s&&s.visible) return {s,i:s.n-1}; continue;}
    const s=x.object.userData.s; return {s,i:Math.min(s.n-1,Math.floor(x.faceIndex/s.trisPer))};
  }
  return null;
}
renderer.domElement.addEventListener('pointerup',e=>{
  if(!down)return; const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y); down=null; if(moved>5||e.button!==0)return;
  const h=hitSlab(e);
  if(h){ if(selected!==h.s) focusStack(h.s); showSlab(h.s,h.i); }
  else if(selected) clearSel();
});
renderer.domElement.addEventListener('dblclick',e=>{if(hitSlab(e))return;const p=groundAt(e);if(p){const a=sph();flyTo(p,Math.max(40,a.d*0.4));}});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('pointermove',e=>{hoverQueued=e;});
renderer.domElement.addEventListener('pointerleave',()=>{hoverQueued=null;tip.hidden=true;renderer.domElement.style.cursor='';});
function doHover(){
  if(!hoverQueued)return; const e=hoverQueued; hoverQueued=null;
  if(down){tip.hidden=true;return;}
  const h=hitSlab(e), r=view.getBoundingClientRect();
  if(h){const row=h.s.rows[h.i]; tip.textContent=`Row ${h.i+1} of ${h.s.n} · ${row.Account} · ${row.Owner||'(no owner)'}`; tip.style.left=(e.clientX-r.left)+'px'; tip.style.top=(e.clientY-r.top)+'px'; tip.hidden=false; renderer.domElement.style.cursor='pointer';}
  else{tip.hidden=true;renderer.domElement.style.cursor='';}
}

// ---------- keyboard ----------
renderer.domElement.addEventListener('keydown',e=>{
  const a=sph(),k=e.key.toLowerCase(); let used=true;
  const fwd=new THREE.Vector3(-Math.cos(a.th),-Math.sin(a.th),0), right=new THREE.Vector3(Math.sin(a.th),-Math.cos(a.th),0), sd=a.d*0.08;
  const move=v=>{stopAnim();camera.position.add(v);controls.target.add(v);};
  if(k==='arrowup'||k==='w')move(fwd.multiplyScalar(sd));
  else if(k==='arrowdown'||k==='s')move(fwd.multiplyScalar(-sd));
  else if(k==='arrowleft'||k==='a')move(right.multiplyScalar(-sd));
  else if(k==='arrowright'||k==='d')move(right.multiplyScalar(sd));
  else if(k==='q')flyTo(controls.target.clone(),a.d,a.phi,a.th-0.35,300);
  else if(k==='e')flyTo(controls.target.clone(),a.d,a.phi,a.th+0.35,300);
  else if(k==='r')flyTo(controls.target.clone(),a.d,Math.max(0.02,a.phi-0.15),a.th,300);
  else if(k==='f')flyTo(controls.target.clone(),a.d,Math.min(84*D2R,a.phi+0.15),a.th,300);
  else if(k==='+'||k==='=')flyTo(controls.target.clone(),Math.max(MIND,a.d*0.75),a.phi,a.th,250);
  else if(k==='-'||k==='_')flyTo(controls.target.clone(),Math.min(MAXD,a.d*1.33),a.phi,a.th,250);
  else if(k==='n')step(1); else if(k==='p')step(-1);
  else if(k==='t')flyTo(controls.target.clone(),a.d,a.phi<0.1?55*D2R:0.02,a.th);
  else if(k==='home')resetView();
  else if(k==='escape'){ if(detailRow!=null) backToRows(); else clearSel(); }
  else used=false;
  if(used)e.preventDefault();
});

// ---------- buttons ----------
document.getElementById('bFit').onclick=resetView;
document.getElementById('b2d').onclick=()=>{const a=sph();flyTo(controls.target.clone(),a.d,0.02,a.th);};
document.getElementById('b3d').onclick=()=>{const a=sph();flyTo(controls.target.clone(),a.d,58*D2R,a.th);};
const north=()=>{const a=sph();flyTo(controls.target.clone(),a.d,a.phi,-Math.PI/2,600);};
const comp=document.getElementById('compass'); comp.onclick=north; comp.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();north();}};
colorBy.onchange=()=>{legend();stacks.forEach(paintStack);paintBeacons();};
autoT.onchange=()=>{buildAll(); if(selected) renderInspector();};
minN.oninput=()=>{document.getElementById('minNv').textContent=minN.value;filtersChanged();};
fCause.onchange=filtersChanged; fUse.onchange=filtersChanged;
fFind.addEventListener('input',()=>{filtersChanged(); const q=fFind.value.trim(); if(q.length<3)return; const s=stacks.find(s=>s.visible); if(s&&s!==selected)focusStack(s);});

// ---------- facts ----------
const sumRows=stacks.reduce((a,s)=>a+s.n,0);
document.getElementById('facts').innerHTML=[[fmtInt(D.parcels),'parcels in the layer'],[fmtInt(stacks.length),'stacks (2+ rows, same shape)'],[fmtInt(sumRows),'rows sitting in stacks'],[fmtInt(stacks.filter(s=>s.exact).length),'stacks with byte-identical geometry']]
  .map(([b,t])=>`<div class="fact"><b>${b}</b><span>${t}</span></div>`).join('');
document.getElementById('howText').textContent=`Every parcel in the file is drawn as the flat ground. Wherever two or more rows have the same shape, each row becomes an 80 ft slab stacked on that footprint. Shapes were compared in ${D.detect_crs} after rounding to 0.01 ft and putting every ring in the same direction and starting corner.`;
const big=stacks.filter(s=>s.cause==='dump');
document.getElementById('bigfinding').textContent= big.length? `The tallest stacks stand out: ${big.slice(0,3).map(s=>`${s.n} rows on one ${s.acres} ac shape`).join(', ')}. Shapes like that are usually a placeholder polygon that unmapped accounts were attached to.`:'';
const lim=[];
if(D.missing_roles.length) lim.push(`No column was found for: ${D.missing_roles.join(', ')}. Those can't be shown or used for coloring. If the file has them under another name, pick them under Columns and build again.`);
if(D.empty_roles&&D.empty_roles.length) lim.push(`These columns are in the file but empty or zero on every row: ${D.empty_roles.join(', ')}.`);
if(D.skipped) lim.push(`${fmtInt(D.skipped)} rows had no usable polygon and were left out.`);
lim.push('Owner names come from the file. The file was read by this browser only; nothing was uploaded, and the view is gone when the tab closes.');
document.getElementById('limits').innerHTML=lim.map(t=>`<li>${esc(t)}</li>`).join('');

// ---------- loop ----------
function resize(){const r=view.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(view); resize();
const needle=document.getElementById('needle');
function loop(now){
  if(anim)anim(now);
  controls.update(); doHover();
  const v=controls.target.clone().sub(camera.position); needle.setAttribute('transform',`rotate(${-Math.atan2(v.x,v.y)*180/Math.PI} 27 27)`);
  renderer.render(scene,camera); requestAnimationFrame(loop);
}
placeCam(new THREE.Vector3(county.cx,county.cy,0),county.r*2.4,45*D2R,-Math.PI/2);
legend(); buildAll(); renderList(); renderInspector();
document.getElementById('scale').textContent=`Ground: ${fmtInt(D.parcels)} parcels · not clickable · about ${Math.max(1,Math.round(D.extent_ft[0]/5280))} × ${Math.max(1,Math.round(D.extent_ft[1]/5280))} mi`;
loadingEl.remove();
requestAnimationFrame(loop);
// ---------- roads and towns (OpenStreetMap), drawn when setContext() is called ----------
const ctxGroup=new THREE.Group(); scene.add(ctxGroup);
const ctxOn=document.getElementById('ctxOn'), ctxNote=document.getElementById('ctxNote');
// Roads: a light center on a dark casing, so they read on both the dark surround and the sand parcels.
const ROAD={local:{color:0xBDB5A6,w:1.6,z:0.2},fm:{color:0xE6DCC3,w:3,z:0.25},major:{color:0xF2C45A,w:5,z:0.3}}, CASING=0x1C1F22;
const pxScale=px=>px*2/(800*(1/Math.tan(20*D2R)));   // sprite scale for about px pixels tall on a typical screen
function textSprite(text,px,{weight=700,fg='#F7F3EA',halo='rgba(22,25,28,.88)',depth=true,alpha=1}={}){
  const c=document.createElement('canvas'),g=c.getContext('2d'),fs=40,font=`${weight} ${fs}px Roboto, "Segoe UI", sans-serif`;
  g.font=font; const w=Math.ceil(g.measureText(text).width+fs*0.7), h=Math.ceil(fs*1.45); c.width=w; c.height=h;
  g.font=font; g.textAlign='center'; g.textBaseline='middle'; g.lineJoin='round'; g.lineWidth=fs*0.26; g.strokeStyle=halo;
  g.strokeText(text,w/2,h/2+1); g.fillStyle=fg; g.fillText(text,w/2,h/2+1);
  const tex=new THREE.CanvasTexture(c); tex.minFilter=THREE.LinearFilter;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,sizeAttenuation:false,depthTest:depth,depthWrite:false,transparent:true,opacity:alpha}));
  const k=pxScale(px); sp.scale.set(k*w/h,k,1); sp.renderOrder=depth?3:10; return sp;
}
function clearContext(){ctxGroup.traverse(o=>{if(o.geometry)o.geometry.dispose(); if(o.material){if(o.material.map)o.material.map.dispose(); o.material.dispose();}}); ctxGroup.clear();}
function setContext(ctx){
  clearContext();
  for(const [cls,st] of Object.entries(ROAD)){
    const tri=[], cas=[], seg=[];
    const ribbon=(out,a,b,L,w,z)=>{const nx=-(b[1]-a[1])/L*w/2, ny=(b[0]-a[0])/L*w/2;
      out.push(a[0]+nx,a[1]+ny,z, a[0]-nx,a[1]-ny,z, b[0]+nx,b[1]+ny,z, b[0]+nx,b[1]+ny,z, a[0]-nx,a[1]-ny,z, b[0]-nx,b[1]-ny,z);};
    ctx.roads.filter(r=>r.cls===cls).forEach(r=>{for(let i=1;i<r.pts.length;i++){const a=r.pts[i-1],b=r.pts[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]); if(!L)continue;
      ribbon(cas,a,b,L,st.w+3,st.z-0.05); ribbon(tri,a,b,L,st.w,st.z); seg.push(a[0],a[1],st.z+0.01,b[0],b[1],st.z+0.01);}});
    if(!seg.length) continue;
    const geo=arr=>{const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3)); return g;};
    ctxGroup.add(new THREE.Mesh(geo(cas),new THREE.MeshBasicMaterial({color:CASING,side:THREE.DoubleSide,transparent:true,opacity:0.7})),
      new THREE.Mesh(geo(tri),new THREE.MeshBasicMaterial({color:st.color,side:THREE.DoubleSide})), new THREE.LineSegments(geo(seg),new THREE.LineBasicMaterial({color:st.color})));
  }
  // road names: highways and farm roads only, about one label every 12 miles of road, and never two labels
  // within about 3 miles of each other or of a town name
  const placed=[], MILE=5280/U, near=(x,y,d)=>placed.some(p=>Math.hypot(p[0]-x,p[1]-y)<d);
  const rank={city:0,town:1,village:2,hamlet:3};
  const towns=ctx.towns.slice().sort((a,b)=>(rank[a.kind]??4)-(rank[b.kind]??4)).slice(0,40);
  towns.forEach(t=>placed.push([t.x,t.y]));
  let nLab=0; const byName=new Map();
  ctx.roads.filter(r=>r.label&&r.cls!=='local').sort((a,b)=>(a.cls==='major'?0:1)-(b.cls==='major'?0:1)).forEach(r=>{(byName.get(r.label)||byName.set(r.label,[]).get(r.label)).push(r);});
  for(const [name,rs] of byName){
    let carry=6*MILE;
    for(const r of rs) for(let i=1;i<r.pts.length&&nLab<80;i++){const a=r.pts[i-1],b=r.pts[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]); carry+=L;
      const x=(a[0]+b[0])/2, y=(a[1]+b[1])/2;
      if(carry>=12*MILE&&!near(x,y,3*MILE)){carry=0; placed.push([x,y]); const sp=textSprite(name,13,{weight:600,fg:'#F3EBD8',depth:false,alpha:0.92}); sp.position.set(x,y,3); ctxGroup.add(sp); nLab++;}}
  }
  // towns
  towns.forEach(t=>{
    const big=t.kind==='city'||t.kind==='town', sp=textSprite(t.name,big?24:16,{weight:big?700:500,fg:'#FFFFFF',depth:false});
    sp.position.set(t.x,t.y,big?60:40); ctxGroup.add(sp);});
  ctxGroup.visible=ctxOn.checked;
  ctxNote.textContent=`${fmtInt(ctx.roads.length)} roads, ${fmtInt(ctx.towns.length)} places · © OpenStreetMap contributors`;
}
try{ if(localStorage.getItem('wta-stacks-ctx')==='off') ctxOn.checked=false; }catch(e){}
ctxOn.onchange=()=>{ctxGroup.visible=ctxOn.checked; try{localStorage.setItem('wta-stacks-ctx',ctxOn.checked?'on':'off');}catch(e){}};
// for the page tests: how far the orbit point is from the selected stack's center line (scene units)
window.__wtaStacks={pickedSlab:()=>paintedPick?detailRow:null,orbitOffset:()=>selected?Math.hypot(controls.target.x-selected.cx,controls.target.y-selected.cy):null};
return { setContext, contextStatus(t){ ctxNote.textContent=t; } };
}};
