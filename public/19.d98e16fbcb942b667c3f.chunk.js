(this.webpackJsonp=this.webpackJsonp||[]).push([[19],{10:function(e,t,s){"use strict";s.d(t,"a",(function(){return i}));const n=s(41).a.debug,i="undefined"!=typeof window?window:self;t.b=n},38:function(e,t,s){"use strict";s.d(t,"a",(function(){return n}));class n{constructor(e){this._constructor(e)}_constructor(e=!1){this.reuseResults=e,this.listeners={},this.listenerResults={}}addEventListener(e,t,s){var n;this.listenerResults.hasOwnProperty(e)&&(t(...this.listenerResults[e]),s)||(null!==(n=this.listeners[e])&&void 0!==n?n:this.listeners[e]=[]).push({callback:t,once:s})}addMultipleEventsListeners(e){for(const t in e)this.addEventListener(t,e[t])}removeEventListener(e,t){this.listeners[e]&&this.listeners[e].findAndSplice(e=>e.callback===t)}dispatchEvent(e,...t){this.reuseResults&&(this.listenerResults[e]=t);const s=[],n=this.listeners[e];if(n){n.slice().forEach(i=>{-1!==n.findIndex(e=>e.callback===i.callback)&&(s.push(i.callback(...t)),i.once&&this.removeEventListener(e,i.callback))})}return s}cleanup(){this.listeners={},this.listenerResults={}}}},41:function(e,t,s){"use strict";const n={test:location.search.indexOf("test=1")>0,debug:location.search.indexOf("debug=1")>0,http:!1,ssl:!0,multipleConnections:!0,asServiceWorker:!1};t.a=n},9:function(e,t,s){"use strict";s.r(t),s.d(t,"RootScope",(function(){return r}));var n=s(38),i=s(10);class r extends n.a{constructor(){super(),this._overlayIsActive=!1,this.myId=0,this.idle={isIDLE:!0},this.connectionStatus={},this.peerId=0,this.broadcast=(e,t)=>{this.dispatchEvent(e,t)},this.on=(e,t,s)=>{super.addEventListener(e,t,s)},this.addEventListener=this.on,this.off=(e,t)=>{super.removeEventListener(e,t)},this.removeEventListener=this.off,this.on("peer_changed",e=>{this.peerId=e}),this.on("user_auth",e=>{this.myId=e}),this.on("connection_status_change",e=>{const t=e;this.connectionStatus[e.name]=t})}setThemeListener(){const e=window.matchMedia("(prefers-color-scheme: dark)"),t=()=>{this.systemTheme=e.matches?"night":"day",this.myId?this.broadcast("theme_change"):this.setTheme()};e.addEventListener("change",t),t()}setTheme(){const e="night"===this.getTheme().name,t=document.head.querySelector('[name="color-scheme"]');t&&t.setAttribute("content",e?"dark":"light"),document.documentElement.classList.toggle("night",e)}get overlayIsActive(){return this._overlayIsActive}set overlayIsActive(e){this._overlayIsActive=e,this.broadcast("overlay_toggle",e)}getTheme(e=("system"===this.settings.theme?this.systemTheme:this.settings.theme)){return this.settings.themes.find(t=>t.name===e)}}const c=new r;i.a.rootScope=c,t.default=c}}]);
//# sourceMappingURL=19.d98e16fbcb942b667c3f.chunk.js.map