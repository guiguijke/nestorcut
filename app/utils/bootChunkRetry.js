// Un chunk JS qui échoue PENDANT le démarrage (522 Cloudflare, déploiement en
// cours) laisse le HTML du serveur à l'écran, mais aucun bouton ne répond
// (AGENTS.md §2 #64). Script en ligne, posé avant les modules : il doit tourner
// même si l'entrée de l'application ne se charge jamais, donc pas de plugin Nuxt.
//
// - Seuls nos chunks comptent : la balise Cloudflare, refusée par la CSP à chaque
//   chargement, est elle aussi un <script type="module"> en erreur.
// - Une fois l'hydratation finie, on ne recharge plus : un chunk paresseux en échec
//   ne doit pas tuer un calcul navigateur en cours ni une saisie.
// - Sans sessionStorage, pas de garde contre la boucle, donc pas de rechargement.
export const BOOT_RELOAD_KEY = 'nestorcut:boot-reload'
export const BOOT_RELOAD_TTL_MS = 10000

export const bootChunkRetryScript = `(function(){
var KEY=${JSON.stringify(BOOT_RELOAD_KEY)},TTL=${BOOT_RELOAD_TTL_MS};
function booted(){
var root=document.getElementById('__nuxt');
var app=root&&root.__vue_app__;
return !!(app&&app.$nuxt&&!app.$nuxt.isHydrating);
}
function retry(){
if(booted())return;
try{
if(Date.now()-(Number(sessionStorage.getItem(KEY))||0)<TTL)return;
sessionStorage.setItem(KEY,String(Date.now()));
}catch(e){return}
location.reload();
}
window.addEventListener('error',function(e){
var t=e.target;
if(t&&t.tagName==='SCRIPT'&&t.type==='module'&&t.src.indexOf('/_nuxt/')!==-1)retry();
},true);
window.addEventListener('vite:preloadError',retry);
})();`
