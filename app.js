/* Cerca — ubicación familiar, lugares seguros, SOS y chat.
   Todo vive en el navegador + un espacio de Firestore por familia:
   spaces/fam-<CODIGO>/docs  →  m-<id> miembros · g-<id> lugares · c-<ts> mensajes */
'use strict';

/* ---------- Config ---------- */
const FB_DEFAULT = { apiKey:'AIzaSyDmeaIi8ywuhr2CsADVgNwScnX-He8LSmo', authDomain:'rumbo-3ba8c.firebaseapp.com', projectId:'rumbo-3ba8c', appId:'1:6067423345:web:a266fd90967dbbf73673d0' };
const FB_SDK = [
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'
];
const LS = 'cerca.v1';
const EMOJIS_M = ['🙂','🧒','👧','👦','👩','👨','🧔','👵','🐶','🐱','🦊','🚀'];
const EMOJIS_L = ['🏠','🏫','🏥','🏢','⚽','🛒','👵','🏖️','⛪','📚'];
const COLORES  = ['#3ecf9a','#5b8cff','#ffc34d','#ff7a7a','#c08bff','#4dd0e1','#ff9f68','#9ccc65'];
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin I, O, 0, 1
const MAX_CHAT = 120;

/* ---------- Estado ---------- */
const S = {
  fam:null,            // {codigo, nombre}
  yo:null,             // {id, nombre, rol, emoji, color}
  cfg:{ frec:60, notif:false, pausa:false, fb:null },
  docs:{},             // id → doc de Firestore
  geo:{},              // lugarId → 'dentro' | 'fuera'
  visto:0,             // ts del último mensaje ya mostrado/notificado
  sosVistos:[],        // SOS ya atendidos ("quien-cuando"), para que no revivan
  pos:null,            // GeolocationPosition más reciente
  bat:null,            // {nivel, cargando}
  envio:0,             // ts del último envío a la nube
  posEnviada:null,
  fb:null,             // {col, unsub}
  mapa:null, capas:{}, circulos:{}, seguir:true,
  eligiendoEnMapa:false,
  lugarEdit:null,
  wake:null,
  sosTimer:null, sosActivo:null
};

/* ---------- Utilidades ---------- */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const ahora = () => Date.now();
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

function toast(t){ const el = $('#toast'); el.textContent = t; el.classList.add('ver'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('ver'), 2800); }

function guardar(){
  try{ localStorage.setItem(LS, JSON.stringify({ fam:S.fam, yo:S.yo, cfg:S.cfg, geo:S.geo, visto:S.visto, sosVistos:S.sosVistos })); }
  catch(e){ /* almacenamiento lleno o bloqueado: la app sigue en memoria */ }
}
function cargar(){
  try{
    const d = JSON.parse(localStorage.getItem(LS) || 'null');
    if(!d) return;
    S.fam = d.fam || null; S.yo = d.yo || null;
    S.cfg = Object.assign(S.cfg, d.cfg || {});
    S.geo = d.geo || {}; S.visto = d.visto || 0; S.sosVistos = d.sosVistos || [];
  }catch(e){ /* dato corrupto: parte limpio */ }
}

function codigoNuevo(){ let c = ''; for(let i = 0; i < 6; i++) c += ALFA[Math.floor(Math.random() * ALFA.length)]; return c; }

function metros(a, b){
  if(!a || !b) return Infinity;
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const m = Math.sin(dLat/2)**2 + Math.cos(a.lat*r) * Math.cos(b.lat*r) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(m));
}

function hace(ts){
  if(!ts) return 'sin datos';
  const s = Math.round((ahora() - ts) / 1000);
  if(s < 45) return 'ahora';
  if(s < 3600) return 'hace ' + Math.round(s/60) + ' min';
  if(s < 86400) return 'hace ' + Math.round(s/3600) + ' h';
  const d = new Date(ts);
  return d.toLocaleDateString('es-CL', { day:'numeric', month:'short' }) + ' ' + d.toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit' });
}
const hora = (ts) => new Date(ts).toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit' });

function cargarScript(src){
  return new Promise((ok, mal) => {
    if(document.querySelector('script[src="' + src + '"]')) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

/* ---------- Selectores de emoji / color ---------- */
function pintarPick(cont, items, valor, onPick, esColor){
  cont.innerHTML = '';
  items.forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    if(esColor){ b.style.background = v; b.title = v; } else b.textContent = v;
    b.setAttribute('aria-pressed', String(v === valor));
    b.onclick = () => { onPick(v); Array.from(cont.children).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
    cont.appendChild(b);
  });
}

/* =======================================================================
   ONBOARDING
   ======================================================================= */
const borrador = { codigo:null, famNombre:'', nombre:'', rol:'adulto', emoji:'🙂', color:COLORES[0], nueva:false };

function onbMostrar(id){ ['onbInicio','onbCrear','onbUnirme','onbPerfil'].forEach((p) => $('#' + p).classList.toggle('oculto', p !== id)); }

function onbIniciar(){
  const invitado = new URLSearchParams(location.search).get('f');
  onbMostrar('onbInicio');
  if(invitado){ $('#onbCodigo').value = invitado.toUpperCase().slice(0, 6); onbMostrar('onbUnirme'); }

  $('#btnCrear').onclick  = () => { borrador.nueva = true;  onbMostrar('onbCrear'); };
  $('#btnUnirme').onclick = () => { borrador.nueva = false; onbMostrar('onbUnirme'); };
  $$('#onb [data-volver]').forEach((b) => b.onclick = () => onbMostrar('onbInicio'));

  $('#btnCrearSig').onclick = () => {
    const n = $('#onbFamNombre').value.trim();
    if(!n){ toast('Escribe un nombre para la familia'); return; }
    borrador.famNombre = n; borrador.codigo = codigoNuevo(); onbPerfil();
  };
  $('#btnUnirmeSig').onclick = () => {
    const c = $('#onbCodigo').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if(c.length < 4){ toast('El código tiene 6 caracteres'); return; }
    borrador.codigo = c; borrador.famNombre = ''; onbPerfil();
  };

  $$('#onbRol button').forEach((b) => b.onclick = () => {
    borrador.rol = b.dataset.rol;
    $$('#onbRol button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });

  $('#btnPerfilListo').onclick = async () => {
    const n = $('#onbNombre').value.trim();
    if(!n){ toast('Escribe tu nombre'); return; }
    S.fam = { codigo:borrador.codigo, nombre:borrador.famNombre || 'Mi familia' };
    S.yo  = { id:uid(), nombre:n, rol:borrador.rol, emoji:borrador.emoji, color:borrador.color };
    guardar();
    $('#onb').classList.add('oculto'); $('#app').classList.remove('oculto');
    await arrancar();
    if(borrador.nueva) abrirHoja('hojaInvitar');
  };
}
function onbPerfil(){
  onbMostrar('onbPerfil');
  pintarPick($('#onbEmoji'), EMOJIS_M, borrador.emoji, (v) => borrador.emoji = v);
  pintarPick($('#onbColor'), COLORES, borrador.color, (v) => borrador.color = v, true);
}

/* =======================================================================
   NUBE (Firestore)
   ======================================================================= */
function setPunto(estado, titulo){
  const p = $('#hPunto');
  p.className = 'punto' + (estado === 'on' ? ' on' : estado === 'err' ? ' err' : '');
  p.title = titulo || '';
}

/* Ninguna espera puede dejar la app colgada en "Conectando…" */
function conLimite(p, ms, msg){
  return Promise.race([p, new Promise((_, rechaza) => setTimeout(() => rechaza(new Error(msg)), ms))]);
}

async function conectar(){
  try{
    setPunto('', 'Conectando…');
    for(const u of FB_SDK) await conLimite(cargarScript(u), 20000, 'No llegó la librería de la nube: revisa la conexión');
    const cfg = S.cfg.fb || FB_DEFAULT;
    if(!firebase.apps.length) firebase.initializeApp(cfg);
    const auth = firebase.auth(), fs = firebase.firestore();
    // La caché offline es opcional: se pide sin esperarla para no bloquear el arranque.
    try{ fs.enablePersistence({ synchronizeTabs:true }).catch(() => {}); }catch(e){ /* navegador sin soporte */ }
    $('#avProyecto').textContent = cfg.projectId;
    if(!auth.currentUser) await conLimite(auth.signInAnonymously(), 25000, 'La nube no respondió a tiempo');

    const col = fs.collection('spaces').doc('fam-' + S.fam.codigo).collection('docs');
    S.fb = { col, cfg };
    if(S.fb.unsub) S.fb.unsub();
    S.fb.unsub = col.onSnapshot((snap) => {
      snap.docs.forEach((d) => { S.docs[d.id] = d.data(); });
      snap.docChanges().forEach((ch) => { if(ch.type === 'removed') delete S.docs[ch.doc.id]; });
      // El primer aviso suele venir del caché; solo se avisa "sin conexión" si nunca llegó el servidor.
      if(!snap.metadata.fromCache) S.fbServidor = true;
      setPunto('on', (snap.metadata.fromCache && !S.fbServidor) ? 'Conectando… (mostrando datos guardados)' : 'Conectado · ' + cfg.projectId);
      alDatoNuevo();
    }, (e) => {
      setPunto('err', e.message);
      toast(e.code === 'permission-denied' ? 'La nube rechazó el acceso: revisa las reglas de Firestore' : 'Nube: ' + (e.code || e.message));
    });

    await publicarme(true);
  }catch(e){
    setPunto('err', e.message || String(e));
    toast(e.code === 'auth/operation-not-allowed'
      ? 'Habilita el acceso Anónimo en Firebase → Authentication'
      : 'No se pudo conectar: ' + (e.message || e));
  }
}

/* Escribe mi tarjeta de miembro (identidad + posición + batería) */
async function publicarme(forzar){
  if(!S.fb) return;
  const d = {
    tipo:'m', id:S.yo.id, nombre:S.yo.nombre, rol:S.yo.rol, emoji:S.yo.emoji, color:S.yo.color,
    fam:S.fam.nombre, pausa:!!S.cfg.pausa, updatedAt:ahora()
  };
  const m = S.docs['m-' + S.yo.id];
  if(m && m.sos) d.sos = m.sos;
  if(S.bat){ d.bat = S.bat.nivel; d.carg = S.bat.cargando; }
  if(S.pos && !S.cfg.pausa){
    d.lat = +S.pos.coords.latitude.toFixed(6);
    d.lng = +S.pos.coords.longitude.toFixed(6);
    d.acc = Math.round(S.pos.coords.accuracy || 0);
    d.ts  = S.pos.timestamp;
    S.posEnviada = { lat:d.lat, lng:d.lng };
  }else if(m){
    // pausado: conserva la última posición conocida, sin actualizar la hora
    if(m.lat != null){ d.lat = m.lat; d.lng = m.lng; d.acc = m.acc; d.ts = m.ts; }
  }
  S.envio = ahora();
  try{ await S.fb.col.doc('m-' + S.yo.id).set(d, { merge:false }); }
  catch(e){ if(forzar) toast('No se pudo enviar tu posición: ' + (e.code || e.message)); }
  pintarYo();
}

function escribirMensaje(kind, texto, extra){
  if(!S.fb) { toast('Sin conexión a la nube todavía'); return Promise.resolve(); }
  const ts = (extra && extra.ts) || ahora();
  const d = Object.assign({ tipo:'c', kind, de:S.yo.id, nombre:S.yo.nombre, emoji:S.yo.emoji, color:S.yo.color, texto, ts }, extra || {});
  return S.fb.col.doc('c-' + ts.toString(36) + '-' + uid()).set(d).catch((e) => toast('No se envió: ' + (e.code || e.message)));
}

/* Los adultos limpian el historial para no llenar la nube */
function purgarChat(){
  if(!S.fb || S.yo.rol !== 'adulto') return;
  const msgs = Object.entries(S.docs).filter(([id, d]) => d.tipo === 'c').sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
  const sobran = msgs.length - MAX_CHAT;
  for(let i = 0; i < sobran; i++) S.fb.col.doc(msgs[i][0]).delete().catch(() => {});
}

/* =======================================================================
   LECTURA DEL ESTADO COMPARTIDO
   ======================================================================= */
const miembros  = () => Object.values(S.docs).filter((d) => d.tipo === 'm');
const lugares   = () => Object.values(S.docs).filter((d) => d.tipo === 'g').sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
const mensajes  = () => Object.values(S.docs).filter((d) => d.tipo === 'c').sort((a, b) => (a.ts || 0) - (b.ts || 0));

/* Privacidad: los adultos ven a todos; los hijos ven a los adultos y a sí mismos. */
function puedoVer(m){ return S.yo.rol === 'adulto' || m.rol === 'adulto' || m.id === S.yo.id; }
const visibles = () => miembros().filter(puedoVer).sort((a, b) => (a.id === S.yo.id ? -1 : b.id === S.yo.id ? 1 : (a.nombre || '').localeCompare(b.nombre || '')));

function alDatoNuevo(){
  const fam = miembros().find((m) => m.fam)?.fam;
  if(fam && fam !== S.fam.nombre){ S.fam.nombre = fam; guardar(); }
  $('#hFam').textContent = S.fam.nombre;

  revisarNuevos();
  pintarMapa(); pintarTiras(); pintarLugares(); pintarAvisos(); pintarChat(); pintarMiembros(); pintarYo();
  purgarChat();
}

/* =======================================================================
   UBICACIÓN
   ======================================================================= */
function iniciarUbicacion(){
  if(!navigator.geolocation){ toast('Este navegador no entrega ubicación'); return; }
  if(!window.isSecureContext) toast('La ubicación solo funciona en https:// (o localhost)');
  navigator.geolocation.watchPosition(alPosicion, (e) => {
    const t = { 1:'Permiso de ubicación denegado: habilítalo en el candado de la barra de direcciones', 2:'Sin señal de GPS por ahora', 3:'El GPS tardó demasiado' };
    $('#yoUbic').textContent = t[e.code] || e.message;
    if(e.code === 1) setAviso('sin');
  }, { enableHighAccuracy:true, maximumAge:15000, timeout:25000 });

  if(navigator.getBattery){
    navigator.getBattery().then((b) => {
      const leer = () => { S.bat = { nivel:Math.round(b.level * 100), cargando:b.charging }; pintarYo(); };
      leer(); b.addEventListener('levelchange', leer); b.addEventListener('chargingchange', leer);
    }).catch(() => {});
  }
  setInterval(() => { if(S.pos) evaluarEnvio(); }, 15000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden && S.pos) publicarme(); });
}

function alPosicion(p){
  S.pos = p;
  evaluarGeocercas();
  evaluarEnvio();
  if(S.seguir && S.mapa && !S.eligiendoEnMapa) centrarEnMi(false);
  pintarYo();
}

function evaluarEnvio(){
  if(S.cfg.pausa){ if(ahora() - S.envio > 300000) publicarme(); return; }
  const lejos = S.posEnviada && metros(S.posEnviada, { lat:S.pos.coords.latitude, lng:S.pos.coords.longitude }) > 75;
  if(!S.envio || lejos || ahora() - S.envio >= S.cfg.frec * 1000) publicarme();
}

function evaluarGeocercas(){
  if(!S.pos || S.cfg.pausa) return;
  const yo = { lat:S.pos.coords.latitude, lng:S.pos.coords.longitude };
  lugares().forEach((l) => {
    const d = metros(yo, { lat:l.lat, lng:l.lng });
    const previo = S.geo[l.id];
    let estado = previo;
    if(d <= l.radio) estado = 'dentro';
    else if(d > l.radio * 1.15) estado = 'fuera';
    if(estado === previo) return;
    S.geo[l.id] = estado; guardar();
    if(previo === undefined) return;             // primera lectura: no avisa
    escribirMensaje('geo', (estado === 'dentro' ? 'llegó a ' : 'salió de ') + l.nombre,
      { lugar:l.nombre, lugarEmoji:l.emoji, dir:estado, lat:+yo.lat.toFixed(6), lng:+yo.lng.toFixed(6) });
  });
}

/* =======================================================================
   MAPA
   ======================================================================= */
function iniciarMapa(){
  if(typeof L === 'undefined'){   // sin la librería del mapa la app sigue sirviendo: chat, lugares y SOS
    $('#mapa').innerHTML = '<div class="vacio" style="padding:30px">No se pudo cargar el mapa.<br>El resto de la app funciona igual.</div>';
    return;
  }
  S.mapa = L.map('mapa', { zoomControl:false, attributionControl:true }).setView([-40.5739, -73.1335], 13); // Osorno
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19, attribution:'© OpenStreetMap'
  }).addTo(S.mapa);
  L.control.zoom({ position:'topright' }).addTo(S.mapa);
  S.mapa.on('dragstart', () => { S.seguir = false; });
  S.mapa.on('click', (e) => {
    if(!S.eligiendoEnMapa) return;
    S.lugarEdit.lat = +e.latlng.lat.toFixed(6); S.lugarEdit.lng = +e.latlng.lng.toFixed(6);
    S.eligiendoEnMapa = false;
    abrirHoja('hojaLugar'); pintarHojaLugar(); pintarMapa();
  });
}

function pintarMapa(){
  if(!S.mapa) return;
  const vivos = new Set();
  visibles().forEach((m) => {
    if(m.lat == null) return;
    vivos.add(m.id);
    const viejo = ahora() - (m.ts || 0) > 15 * 60000;
    const html = '<div class="pin' + (viejo ? ' viejo' : '') + (m.sos ? ' sos' : '') + '" style="background:' + esc(m.color || '#5b8cff') + '">' + esc(m.emoji || '🙂') + '</div>';
    const icon = L.divIcon({ html, className:'', iconSize:[38, 38], iconAnchor:[19, 19] });
    const txt = '<b>' + esc(m.nombre) + '</b><br>' + hace(m.ts) +
      (m.bat != null ? '<br>🔋 ' + m.bat + '%' + (m.carg ? ' cargando' : '') : '') +
      (m.acc ? '<br>± ' + m.acc + ' m' : '') + (m.pausa ? '<br>⏸️ ubicación pausada' : '');
    if(S.capas[m.id]){ S.capas[m.id].setLatLng([m.lat, m.lng]).setIcon(icon).setPopupContent(txt); }
    else { S.capas[m.id] = L.marker([m.lat, m.lng], { icon }).addTo(S.mapa).bindPopup(txt); }
  });
  Object.keys(S.capas).forEach((id) => { if(!vivos.has(id)){ S.mapa.removeLayer(S.capas[id]); delete S.capas[id]; } });

  const ids = new Set();
  lugares().forEach((l) => {
    ids.add(l.id);
    if(S.circulos[l.id]) S.circulos[l.id].setLatLng([l.lat, l.lng]).setRadius(l.radio);
    else S.circulos[l.id] = L.circle([l.lat, l.lng], { radius:l.radio, color:'#3ecf9a', weight:1.5, fillColor:'#3ecf9a', fillOpacity:.1 })
      .addTo(S.mapa).bindPopup('<b>' + esc(l.emoji + ' ' + l.nombre) + '</b><br>' + l.radio + ' m');
  });
  Object.keys(S.circulos).forEach((id) => { if(!ids.has(id)){ S.mapa.removeLayer(S.circulos[id]); delete S.circulos[id]; } });

  if(S.lugarEdit && S.lugarEdit.lat != null){
    if(!S.capas._edit) S.capas._edit = L.circle([S.lugarEdit.lat, S.lugarEdit.lng], { radius:S.lugarEdit.radio, color:'#ffc34d', dashArray:'5 5', fillOpacity:.08 }).addTo(S.mapa);
    else S.capas._edit.setLatLng([S.lugarEdit.lat, S.lugarEdit.lng]).setRadius(S.lugarEdit.radio);
  }else if(S.capas._edit){ S.mapa.removeLayer(S.capas._edit); delete S.capas._edit; }
}

function centrarEnMi(zoom){
  if(!S.pos || !S.mapa) return;
  const ll = [S.pos.coords.latitude, S.pos.coords.longitude];
  if(zoom) S.mapa.setView(ll, Math.max(S.mapa.getZoom(), 16), { animate:true }); else S.mapa.panTo(ll, { animate:true });
}
function verTodos(){
  const pts = visibles().filter((m) => m.lat != null).map((m) => [m.lat, m.lng]);
  if(!pts.length){ toast('Todavía no hay posiciones'); return; }
  S.seguir = false;
  if(pts.length === 1) S.mapa.setView(pts[0], 15); else S.mapa.fitBounds(L.latLngBounds(pts).pad(0.25));
}

/* ---------- Tiras de miembros ---------- */
function pintarTiras(){
  const c = $('#tiras'); c.innerHTML = '';
  const ms = visibles();
  if(!ms.length){ c.innerHTML = '<div class="vacio">Esperando a la familia…</div>'; return; }
  ms.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'chip' + (m.sos ? ' alerta' : '');
    const bat = m.bat != null ? ' · 🔋' + m.bat + '%' : '';
    el.innerHTML = '<div class="av" style="background:' + esc(m.color) + '">' + esc(m.emoji) + '</div>' +
      '<div><b>' + esc(m.nombre) + (m.id === S.yo.id ? ' (tú)' : '') + '</b>' +
      '<small>' + (m.pausa ? '⏸️ pausada' : hace(m.ts)) + bat + '</small></div>';
    el.onclick = () => {
      if(m.lat == null){ toast('Sin posición de ' + m.nombre + ' todavía'); return; }
      S.seguir = (m.id === S.yo.id);
      S.mapa.setView([m.lat, m.lng], 16, { animate:true });
      if(S.capas[m.id]) S.capas[m.id].openPopup();
    };
    c.appendChild(el);
  });
}

/* =======================================================================
   LUGARES
   ======================================================================= */
function pintarLugares(){
  const c = $('#listaLugares'); c.innerHTML = '';
  const ls = lugares();
  if(!ls.length){ c.innerHTML = '<div class="vacio">Sin lugares todavía. Agrega la casa y el colegio.</div>'; return; }
  const yo = S.pos ? { lat:S.pos.coords.latitude, lng:S.pos.coords.longitude } : null;
  ls.forEach((l) => {
    const dentro = visibles().filter((m) => m.lat != null && !m.pausa && metros({ lat:m.lat, lng:m.lng }, { lat:l.lat, lng:l.lng }) <= l.radio);
    const d = yo ? metros(yo, { lat:l.lat, lng:l.lng }) : null;
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = '<div class="ic">' + esc(l.emoji) + '</div><div class="tx"><b>' + esc(l.nombre) + '</b><small>' +
      l.radio + ' m · ' + (dentro.length ? 'ahí: ' + dentro.map((m) => esc(m.nombre)).join(', ') : 'nadie ahí') +
      (d != null ? ' · a ' + (d > 1200 ? (d/1000).toFixed(1) + ' km' : Math.round(d) + ' m') + ' de ti' : '') +
      '</small></div>';
    const bVer = document.createElement('button'); bVer.className = 'mini'; bVer.textContent = '🗺️';
    bVer.onclick = () => { irA('vMapa'); S.seguir = false; S.mapa.setView([l.lat, l.lng], 15); };
    const bEd = document.createElement('button'); bEd.className = 'mini'; bEd.textContent = '✏️';
    bEd.onclick = () => abrirLugar(l);
    el.append(bVer, bEd);
    c.appendChild(el);
  });
}

function abrirLugar(l){
  S.lugarEdit = l ? Object.assign({}, l) : { id:uid(), nombre:'', emoji:'🏠', radio:150, lat:null, lng:null };
  $('#lugarTitulo').textContent = l ? 'Editar lugar' : 'Nuevo lugar';
  $('#btnLugarBorrar').classList.toggle('oculto', !l);
  if(!l && S.pos){ S.lugarEdit.lat = +S.pos.coords.latitude.toFixed(6); S.lugarEdit.lng = +S.pos.coords.longitude.toFixed(6); }
  pintarHojaLugar(); abrirHoja('hojaLugar'); pintarMapa();
}
function pintarHojaLugar(){
  const l = S.lugarEdit;
  $('#lugarNombre').value = l.nombre || '';
  $('#lugarRadio').value = l.radio; $('#lugarRadioTx').textContent = l.radio + ' m';
  $('#lugarCentro').textContent = l.lat == null ? 'sin elegir' : l.lat.toFixed(5) + ', ' + l.lng.toFixed(5);
  pintarPick($('#lugarEmoji'), EMOJIS_L, l.emoji, (v) => l.emoji = v);
}

function pintarAvisos(){
  const c = $('#listaAvisos'); c.innerHTML = '';
  const av = mensajes().filter((m) => m.kind === 'geo' || m.kind === 'sos' || m.kind === 'checkin').slice(-12).reverse();
  if(!av.length){ c.innerHTML = '<div class="vacio">Sin avisos todavía.</div>'; return; }
  av.forEach((m) => {
    const ic = m.kind === 'sos' ? '🚨' : m.kind === 'checkin' ? '✅' : (m.lugarEmoji || '📍');
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = '<div class="ic">' + esc(ic) + '</div><div class="tx"><b>' + esc(m.nombre) + ' ' + esc(m.texto) + '</b><small>' + hace(m.ts) + '</small></div>';
    if(m.lat != null){
      const b = document.createElement('button'); b.className = 'mini'; b.textContent = '🗺️';
      b.onclick = () => { irA('vMapa'); S.seguir = false; S.mapa.setView([m.lat, m.lng], 16); };
      el.appendChild(b);
    }
    c.appendChild(el);
  });
}

/* =======================================================================
   CHAT
   ======================================================================= */
function pintarChat(){
  const c = $('#chatLista');
  const pegado = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
  c.innerHTML = '';
  const ms = mensajes();
  if(!ms.length) c.innerHTML = '<div class="vacio">Sin mensajes. Escribe el primero.</div>';
  ms.forEach((m) => {
    const el = document.createElement('div');
    const mio = m.de === S.yo.id;
    if(m.kind === 'sos'){
      el.className = 'msg sos';
      el.innerHTML = '🚨 <b>' + esc(m.nombre) + ' pidió ayuda</b><br>' + hora(m.ts) +
        (m.lat != null ? ' · <a href="https://www.google.com/maps?q=' + m.lat + ',' + m.lng + '" target="_blank" rel="noopener">abrir en Maps</a>' : '');
    }else if(m.kind === 'sistema' || m.kind === 'geo' || m.kind === 'checkin'){
      const ic = m.kind === 'checkin' ? '✅ ' : m.kind === 'geo' ? (m.lugarEmoji || '📍') + ' ' : '';
      el.className = 'msg sistema';
      el.innerHTML = ic + esc(m.kind === 'sistema' ? m.texto : m.nombre + ' ' + m.texto) + ' · ' + hora(m.ts);
    }else{
      el.className = 'msg' + (mio ? ' mio' : '');
      el.innerHTML = (mio ? '' : '<span class="quien">' + esc(m.emoji + ' ' + m.nombre) + '</span>') +
        '<span class="hora">' + hora(m.ts) + '</span>' + esc(m.texto);
    }
    c.appendChild(el);
  });
  if(pegado) c.scrollTop = c.scrollHeight;

  const sinLeer = ms.filter((m) => m.ts > S.visto && m.de !== S.yo.id && m.kind !== 'sistema').length;
  const g = $('#navGlobo');
  g.textContent = sinLeer > 9 ? '9+' : sinLeer;
  g.classList.toggle('oculto', !sinLeer || $('#vChat').classList.contains('activa'));
  if($('#vChat').classList.contains('activa')) marcarVisto();
}
function marcarVisto(){
  const ms = mensajes();
  if(ms.length){ S.visto = Math.max(S.visto, ms[ms.length - 1].ts); guardar(); }
  $('#navGlobo').classList.add('oculto');
}

function enviarMensaje(){
  const t = $('#chatTexto').value.trim();
  if(!t) return;
  $('#chatTexto').value = ''; $('#chatTexto').style.height = 'auto';
  escribirMensaje('msg', t);
}

/* =======================================================================
   SOS + AVISOS
   ======================================================================= */
const claveSOS = (m) => m.de + '-' + m.ts;
const sosAtendido = (m) => S.sosVistos.includes(claveSOS(m));

function revisarNuevos(){
  const nuevos = mensajes().filter((m) => m.ts > S.visto && m.de !== S.yo.id);
  const sos = nuevos.filter((m) => m.kind === 'sos' && !sosAtendido(m)).pop();
  if(sos){ mostrarAlertaSOS(sos); }
  else {
    const sosVivo = miembros().find((m) => m.sos && m.id !== S.yo.id && ahora() - m.sos < 3600000
      && !sosAtendido({ de:m.id, ts:m.sos }));
    if(sosVivo) mostrarAlertaSOS({ nombre:sosVivo.nombre, ts:sosVivo.sos, de:sosVivo.id, lat:sosVivo.lat, lng:sosVivo.lng });
    else { $('#alertaSOS').classList.remove('abierta'); S.sosActivo = null; }
  }
  if(!S.cfg.notif || !nuevos.length) return;
  if(document.hidden || sos) nuevos.slice(-3).forEach(notificar);
}

function notificar(m){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const titulo = m.kind === 'sos' ? '🚨 ' + m.nombre + ' pidió ayuda'
    : m.kind === 'geo' ? (m.lugarEmoji || '📍') + ' ' + m.nombre + ' ' + m.texto
    : m.kind === 'checkin' ? '✅ ' + m.nombre + ' llegó bien'
    : m.nombre;
  try{
    new Notification(titulo, { body:m.kind === 'msg' ? m.texto : '', icon:'icon-192.png', tag:'cerca-' + m.kind, renotify:m.kind === 'sos' });
    if(navigator.vibrate) navigator.vibrate(m.kind === 'sos' ? [300, 120, 300, 120, 300] : 120);
  }catch(e){ /* algunos navegadores exigen el service worker: se ignora */ }
}

function mostrarAlertaSOS(m){
  S.sosActivo = m;
  $('#sosTexto').textContent = m.nombre + ' pidió ayuda · ' + hace(m.ts);
  $('#alertaSOS').classList.add('abierta');
  if(navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300]);
}

function armarSOS(){
  const anillo = $('#sosAnillo');
  anillo.classList.remove('oculto');
  $('#sos').dataset.armado = 'si';
  const t0 = ahora();
  S.sosTimer = setInterval(() => {
    const p = Math.min(1, (ahora() - t0) / 3000);
    anillo.style.clipPath = 'inset(' + Math.round((1 - p) * 100) + '% 0 0 0)';
    if(p >= 1){ cancelarSOS(); dispararSOS(); }
  }, 50);
}
function cancelarSOS(){
  clearInterval(S.sosTimer); S.sosTimer = null;
  $('#sosAnillo').classList.add('oculto'); $('#sosAnillo').style.clipPath = 'inset(100% 0 0 0)';
  delete $('#sos').dataset.armado;
}
async function dispararSOS(){
  if(navigator.vibrate) navigator.vibrate([500, 150, 500]);
  // El mensaje y la marca del miembro comparten la misma hora: así "Voy" apaga las dos señales.
  const ts = ahora(), extra = { ts };
  if(S.pos){ extra.lat = +S.pos.coords.latitude.toFixed(6); extra.lng = +S.pos.coords.longitude.toFixed(6); extra.acc = Math.round(S.pos.coords.accuracy || 0); }
  await escribirMensaje('sos', 'pidió ayuda', extra);
  if(S.fb) S.fb.col.doc('m-' + S.yo.id).set({ sos:ts }, { merge:true }).catch(() => {});
  toast('🚨 SOS enviado a la familia');
  irA('vChat');
}

/* =======================================================================
   PERFIL / AJUSTES
   ======================================================================= */
function setAviso(modo){
  const a = $('#hAviso'), t = $('#hAvisoTx');
  a.classList.toggle('pausa', modo !== 'ok');
  t.textContent = modo === 'ok' ? 'Compartiendo tu ubicación con la familia'
    : modo === 'pausa' ? 'Tu ubicación está PAUSADA · la familia no te ve'
    : 'Sin permiso de ubicación: la familia no te ve';
  a.firstElementChild.textContent = modo === 'ok' ? '🛰️' : modo === 'pausa' ? '⏸️' : '⚠️';
}

function pintarYo(){
  $('#yoAv').textContent = S.yo.emoji; $('#yoAv').style.background = S.yo.color;
  $('#yoNombre').textContent = S.yo.nombre;
  $('#yoRol').textContent = S.yo.rol === 'adulto' ? 'Adulto · ve a toda la familia' : 'Hijo · ve a los adultos';
  $('#yoUbic').textContent = S.pos
    ? S.pos.coords.latitude.toFixed(5) + ', ' + S.pos.coords.longitude.toFixed(5) + ' (± ' + Math.round(S.pos.coords.accuracy) + ' m)'
    : 'esperando GPS…';
  $('#yoBat').textContent = S.bat ? S.bat.nivel + '%' + (S.bat.cargando ? ' cargando' : '') : 'no disponible';
  $('#yoEnvio').textContent = S.envio ? hace(S.envio) : '—';
  $('#avCodigo').textContent = S.fam.codigo;
  $('#invCodigo').textContent = S.fam.codigo;
  setAviso(S.cfg.pausa ? 'pausa' : S.pos ? 'ok' : 'sin');
}

function pintarMiembros(){
  const c = $('#listaMiembros'); c.innerHTML = '';
  const ms = visibles();
  $('#famCont').textContent = ms.length + (ms.length === 1 ? ' miembro' : ' miembros');
  ms.forEach((m) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = '<div class="ic" style="background:' + esc(m.color) + '">' + esc(m.emoji) + '</div>' +
      '<div class="tx"><b>' + esc(m.nombre) + (m.id === S.yo.id ? ' (tú)' : '') + '</b><small>' +
      (m.rol === 'adulto' ? 'Adulto' : 'Hijo') + ' · ' + (m.pausa ? 'ubicación pausada' : hace(m.ts)) +
      (m.bat != null ? ' · 🔋' + m.bat + '%' : '') + '</small></div>';
    if(m.id !== S.yo.id && S.yo.rol === 'adulto'){
      const b = document.createElement('button'); b.className = 'mini'; b.textContent = '🗑️';
      b.title = 'Quitar de la familia';
      b.onclick = () => {
        if(!confirm('¿Quitar a ' + m.nombre + ' de la familia? Si vuelve a abrir la app en su celular, reaparece.')) return;
        S.fb.col.doc('m-' + m.id).delete().catch((e) => toast('No se pudo: ' + e.code));
      };
      el.appendChild(b);
    }
    c.appendChild(el);
  });
}

function leerFbConfig(txt){
  if(!txt.trim()) return null;
  const out = {};
  txt.replace(/["']?(apiKey|authDomain|projectId|appId|messagingSenderId|storageBucket)["']?\s*:\s*["']([^"']+)["']/g, (_, k, v) => { out[k] = v; return ''; });
  if(!out.apiKey || !out.projectId || !out.appId) return null;
  return { apiKey:out.apiKey, authDomain:out.authDomain || out.projectId + '.firebaseapp.com', projectId:out.projectId, appId:out.appId };
}

async function pedirNotificaciones(){
  if(!('Notification' in window)){ toast('Este navegador no da notificaciones'); return false; }
  if(Notification.permission === 'granted') return true;
  const r = await Notification.requestPermission();
  if(r !== 'granted') toast('Avisos bloqueados en este navegador');
  return r === 'granted';
}

async function alternarDespierto(){
  const b = $('#fabDespierto');
  if(S.wake){ try{ await S.wake.release(); }catch(e){} S.wake = null; b.setAttribute('aria-pressed', 'false'); toast('La pantalla puede apagarse'); return; }
  if(!('wakeLock' in navigator)){ toast('Este navegador no permite mantener la pantalla encendida'); return; }
  try{
    S.wake = await navigator.wakeLock.request('screen');
    S.wake.addEventListener('release', () => { S.wake = null; b.setAttribute('aria-pressed', 'false'); });
    b.setAttribute('aria-pressed', 'true');
    toast('Pantalla encendida: la ubicación se envía sin cortes');
  }catch(e){ toast('No se pudo: ' + e.message); }
}

/* =======================================================================
   NAVEGACIÓN Y ENLACES
   ======================================================================= */
function irA(id){
  $$('.vista').forEach((v) => v.classList.toggle('activa', v.id === id));
  $$('nav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.vista === id)));
  if(id === 'vMapa' && S.mapa) setTimeout(() => S.mapa.invalidateSize(), 60);
  if(id === 'vChat'){ marcarVisto(); const c = $('#chatLista'); c.scrollTop = c.scrollHeight; }
}
function abrirHoja(id){ $('#' + id).classList.add('abierta'); }
function cerrarHojas(){ $$('.hoja').forEach((h) => h.classList.remove('abierta')); }

function linkInvitacion(){
  const u = new URL(location.href);
  u.search = '?f=' + S.fam.codigo; u.hash = '';
  return u.toString();
}

function conectarUI(){
  $$('nav button').forEach((b) => b.onclick = () => irA(b.dataset.vista));
  $$('.hoja [data-cerrar]').forEach((b) => b.onclick = cerrarHojas);
  $$('.hoja').forEach((h) => h.onclick = (e) => { if(e.target === h) cerrarHojas(); });

  // Mapa
  $('#fabCentrar').onclick = () => { S.seguir = true; centrarEnMi(true); if(!S.pos) toast('Esperando el GPS…'); };
  $('#fabTodos').onclick = verTodos;
  $('#fabDespierto').onclick = alternarDespierto;

  // SOS
  const sos = $('#sos');
  sos.addEventListener('pointerdown', (e) => { e.preventDefault(); armarSOS(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => sos.addEventListener(ev, () => { if(S.sosTimer){ cancelarSOS(); toast('Mantén presionado 3 segundos para enviar el SOS'); } }));
  $('#btnSosVer').onclick = () => {
    const m = S.sosActivo;
    irA('vMapa');
    if(m && m.lat != null){ S.seguir = false; S.mapa.setView([m.lat, m.lng], 17); }
    else toast('El SOS llegó sin ubicación');
  };
  $('#btnSosOk').onclick = async () => {
    const m = S.sosActivo; if(!m) return;
    S.sosVistos.push(claveSOS(m));
    if(S.sosVistos.length > 20) S.sosVistos = S.sosVistos.slice(-20);
    guardar();
    $('#alertaSOS').classList.remove('abierta');
    await escribirMensaje('sistema', S.yo.nombre + ' vio el SOS de ' + m.nombre + ' y va en camino');
    if(S.fb && m.de) S.fb.col.doc('m-' + m.de).set({ sos:0 }, { merge:true }).catch(() => {});
    S.sosActivo = null;
  };

  // Lugares
  $('#btnNuevoLugar').onclick = () => abrirLugar(null);
  $('#lugarRadio').oninput = (e) => { S.lugarEdit.radio = +e.target.value; $('#lugarRadioTx').textContent = e.target.value + ' m'; pintarMapa(); };
  $('#btnLugarAqui').onclick = () => {
    if(!S.pos){ toast('Todavía no hay señal de GPS'); return; }
    S.lugarEdit.lat = +S.pos.coords.latitude.toFixed(6); S.lugarEdit.lng = +S.pos.coords.longitude.toFixed(6);
    pintarHojaLugar(); pintarMapa(); toast('Centro puesto donde estás');
  };
  $('#btnLugarMapa').onclick = () => {
    S.eligiendoEnMapa = true; cerrarHojas(); irA('vMapa');
    toast('Toca el mapa donde queda el lugar');
  };
  $('#btnLugarGuardar').onclick = () => {
    const l = S.lugarEdit;
    l.nombre = $('#lugarNombre').value.trim();
    if(!l.nombre){ toast('Ponle nombre al lugar'); return; }
    if(l.lat == null){ toast('Elige el centro del lugar'); return; }
    const d = { tipo:'g', id:l.id, nombre:l.nombre, emoji:l.emoji, lat:l.lat, lng:l.lng, radio:l.radio, por:S.yo.nombre, updatedAt:ahora() };
    S.fb.col.doc('g-' + l.id).set(d).then(() => {
      toast('Lugar guardado'); S.lugarEdit = null; cerrarHojas(); pintarMapa();
    }).catch((e) => toast('No se guardó: ' + (e.code || e.message)));
  };
  $('#btnLugarBorrar').onclick = () => {
    if(!confirm('¿Borrar ' + S.lugarEdit.nombre + '?')) return;
    S.fb.col.doc('g-' + S.lugarEdit.id).delete().then(() => { delete S.geo[S.lugarEdit.id]; guardar(); S.lugarEdit = null; cerrarHojas(); pintarMapa(); });
  };

  // Chat
  $('#btnEnviar').onclick = enviarMensaje;
  $('#chatTexto').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(110, e.target.scrollHeight) + 'px'; });
  $('#chatTexto').addEventListener('keydown', (e) => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); enviarMensaje(); } });
  $('#btnCheckin').onclick = () => {
    const extra = {};
    if(S.pos){ extra.lat = +S.pos.coords.latitude.toFixed(6); extra.lng = +S.pos.coords.longitude.toFixed(6); }
    escribirMensaje('checkin', 'llegó bien', extra); toast('Avisaste que llegaste bien');
  };

  // Invitar
  const invitar = () => { $('#invCodigo').textContent = S.fam.codigo; abrirHoja('hojaInvitar'); };
  $('#btnInvitar').onclick = invitar; $('#btnInvitar2').onclick = invitar;
  $('#btnCompartirLink').onclick = async () => {
    const txt = 'Entra a nuestra familia en Cerca con el código ' + S.fam.codigo + ': ' + linkInvitacion();
    if(navigator.share){ try{ await navigator.share({ title:'Cerca', text:txt }); return; }catch(e){ if(e.name === 'AbortError') return; } }
    location.href = 'https://wa.me/?text=' + encodeURIComponent(txt);
  };
  $('#btnCopiarLink').onclick = async () => {
    try{ await navigator.clipboard.writeText(linkInvitacion()); toast('Enlace copiado'); }
    catch(e){ prompt('Copia este enlace:', linkInvitacion()); }
  };

  // Perfil
  $('#btnEditarPerfil').onclick = () => {
    $('#pfNombre').value = S.yo.nombre;
    $$('#pfRol button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rol === S.yo.rol)));
    pintarPick($('#pfEmoji'), EMOJIS_M, S.yo.emoji, (v) => S.yo._emoji = v);
    pintarPick($('#pfColor'), COLORES, S.yo.color, (v) => S.yo._color = v, true);
    S.yo._rol = S.yo.rol; S.yo._emoji = S.yo.emoji; S.yo._color = S.yo.color;
    abrirHoja('hojaPerfil');
  };
  $$('#pfRol button').forEach((b) => b.onclick = () => {
    S.yo._rol = b.dataset.rol;
    $$('#pfRol button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('#btnPerfilGuardar').onclick = () => {
    const n = $('#pfNombre').value.trim();
    if(!n){ toast('Escribe tu nombre'); return; }
    S.yo.nombre = n; S.yo.rol = S.yo._rol || S.yo.rol; S.yo.emoji = S.yo._emoji; S.yo.color = S.yo._color;
    guardar(); cerrarHojas(); aplicarRol(); publicarme(true); toast('Perfil actualizado');
  };

  // Ajustes
  $('#swPausa').onchange = (e) => {
    S.cfg.pausa = e.target.checked; guardar(); pintarYo();
    escribirMensaje('sistema', S.yo.nombre + (S.cfg.pausa ? ' pausó su ubicación' : ' volvió a compartir su ubicación'));
    publicarme(true);
  };
  $('#selFrec').onchange = (e) => { S.cfg.frec = +e.target.value; guardar(); toast('Listo'); };
  $('#swNotif').onchange = async (e) => {
    if(e.target.checked){ const ok = await pedirNotificaciones(); S.cfg.notif = ok; e.target.checked = ok; }
    else S.cfg.notif = false;
    guardar();
  };
  $('#btnGuardarFb').onclick = () => {
    const txt = $('#avFbConfig').value;
    if(!txt.trim()){ S.cfg.fb = null; guardar(); toast('Se usará el proyecto incorporado al recargar'); return; }
    const c = leerFbConfig(txt);
    if(!c){ toast('No se reconoce el bloque firebaseConfig (faltan apiKey, projectId o appId)'); return; }
    S.cfg.fb = c; guardar(); toast('Guardado. Recarga la app para usar ' + c.projectId);
  };
  $('#btnSalir').onclick = () => {
    if(!confirm('¿Salir de la familia en este celular? Se borra tu tarjeta de la familia y tendrás que entrar de nuevo con el código.')) return;
    if(S.fb) S.fb.col.doc('m-' + S.yo.id).delete().catch(() => {});
    localStorage.removeItem(LS);
    setTimeout(() => location.replace(location.pathname), 400);
  };
}

/* Un hijo no puede pausar su ubicación (ese es el sentido del control familiar) */
function aplicarRol(){
  const hijo = S.yo.rol === 'hijo';
  $('#swPausa').disabled = hijo;
  $('#swPausa').checked = !!S.cfg.pausa && !hijo;
  if(hijo && S.cfg.pausa){ S.cfg.pausa = false; guardar(); }
  $('#swPausaNota').textContent = hijo
    ? 'Los hijos comparten siempre su ubicación con los adultos.'
    : 'Los demás verán que la pausaste.';
  $('#swPausaCaja').style.opacity = hijo ? .55 : 1;
}

/* =======================================================================
   ARRANQUE
   ======================================================================= */
async function arrancar(){
  $('#hFam').textContent = S.fam.nombre;
  $('#selFrec').value = String(S.cfg.frec);
  $('#swNotif').checked = !!S.cfg.notif && ('Notification' in window) && Notification.permission === 'granted';
  if(S.cfg.fb) $('#avFbConfig').value = JSON.stringify(S.cfg.fb, null, 2);
  conectarUI(); aplicarRol(); pintarYo();
  try{ iniciarMapa(); }catch(e){ toast('El mapa no arrancó: ' + e.message); }
  iniciarUbicacion();
  await conectar();
  setInterval(() => { pintarTiras(); pintarMiembros(); pintarYo(); }, 30000);
  if(!S.cfg.notif) pedirNotificaciones().then((ok) => { if(ok){ S.cfg.notif = true; $('#swNotif').checked = true; guardar(); } });
}

async function main(){
  cargar();
  if('serviceWorker' in navigator && location.protocol !== 'file:'){
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if(S.fam && S.yo){
    $('#onb').classList.add('oculto'); $('#app').classList.remove('oculto');
    await arrancar();
  }else{
    onbIniciar();
  }
}

if(typeof document !== 'undefined'){
  // Ventana de inspección: la usan las pruebas y sirve para mirar el estado desde la consola.
  window.Cerca = { S, metros, hace, puedoVer, visibles, miembros, lugares, mensajes, publicarme, escribirMensaje };
  main();
}
// En Node (pruebas.js) no hay DOM: solo se exportan las funciones de lógica pura.
if(typeof module !== 'undefined' && module.exports){
  module.exports = { S, metros, hace, esc, codigoNuevo, leerFbConfig, puedoVer, miembros, lugares, mensajes, ALFA, MAX_CHAT };
}
