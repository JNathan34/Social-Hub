/* SocialHub client shell. Social API OAuth / analytics require a server; no fake connection states. */
(function () {
  "use strict";
  var KEY_PROFILE="socialhub.profile.v1", KEY_PREFS="socialhub.prefs.v1";
  var defaults={name:"Workspace owner",photo:""};
  var profile=readJSON(KEY_PROFILE,defaults);
  var prefs=readJSON(KEY_PREFS,{hideTips:false,compact:false});
  var titles={overview:"Overview",facebook:"Facebook",instagram:"Instagram",tiktok:"TikTok",youtube:"YouTube",audience:"Audience",content:"Content",connections:"Connections",settings:"Settings"};
  var social=[
    {id:"facebook",name:"Facebook",logo:"https://api.iconify.design/logos:facebook.svg",description:"Facebook Pages, post engagement and Page insights.",requirement:"A Facebook Page with sufficient permissions and access to the Page Insights API.",docs:"https://developers.facebook.com/docs/pages-api/"},
    {id:"instagram",name:"Instagram",logo:"https://api.iconify.design/skill-icons:instagram.svg",description:"Instagram Creator and Business profile, media and available insights.",requirement:"An Instagram professional account and an approved Meta app.",docs:"https://developers.facebook.com/docs/instagram-platform/"},
    {id:"tiktok",name:"TikTok",logo:"https://api.iconify.design/logos:tiktok-icon.svg",description:"TikTok profile statistics and recent public videos.",requirement:"A TikTok Developer app with approval for the relevant Login Kit and API scopes.",docs:"https://developers.tiktok.com/"},
    {id:"youtube",name:"YouTube",logo:"https://api.iconify.design/logos:youtube-icon.svg",description:"YouTube channel statistics, video performance and comments.",requirement:"Google OAuth credentials with the YouTube Data API and YouTube Analytics API.",docs:"https://developers.google.com/youtube/v3"}
  ];
  var el=function(id){return document.getElementById(id);};
  var e=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch];});};
  var icon=function(name){return '<i data-lucide="'+name+'"></i>';};
  function readJSON(key,fallback){try{var parsed=JSON.parse(localStorage.getItem(key));return parsed&&typeof parsed==="object"?Object.assign({},fallback,parsed):Object.assign({},fallback);}catch(_){return Object.assign({},fallback);}}
  function persist(key,obj){try{localStorage.setItem(key,JSON.stringify(obj));return true;}catch(_){notify("Browser storage is unavailable. Your changes may not be saved.");return false;}}
  function lucideRefresh(){if(window.lucide&&window.lucide.createIcons)window.lucide.createIcons();}
  function notify(message){var t=el("toast");t.textContent=message;t.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(function(){t.hidden=true;},3800);}
  function avatarInitials(){return (profile.name||"Workspace owner").trim().split(/\s+/).slice(0,2).map(function(w){return w.charAt(0).toUpperCase();}).join("")||"SH";}
  function syncProfile(){
    document.querySelectorAll("[data-profile-name]").forEach(function(node){node.textContent=profile.name||defaults.name;});
    document.querySelectorAll("[data-avatar]").forEach(function(node){node.textContent=profile.photo?"":avatarInitials();node.style.backgroundImage=profile.photo?'url("'+profile.photo+'")':"";});
    el("workspace-initial").textContent=avatarInitials().charAt(0);
  }
  function page(){var p=(location.hash||"#overview").slice(1).toLowerCase();return titles[p]?p:"overview";}
  function navigate(p){if(!titles[p])p="overview";location.hash=p;closeMenu();closeMobile();render();}
  function heading(title,desc,action){
    return '<div class="page-intro"><div><p class="eyebrow">Your social media, in one place</p><h1>'+e(title)+'<span class="period">.</span></h1><p class="page-desc">'+e(desc)+'</p></div><div class="header-actions"><span class="muted-note">No accounts synced yet</span>'+(action||'')+'</div></div>';
  }
  function button(label,action,klass,ic){
    return '<button type="button" class="'+(klass||"primary-button")+'" data-action="'+action+'">'+(ic?icon(ic):"")+e(label)+'</button>';
  }
  function platformLogo(x){return '<span class="platform-logo '+x.id+'"><img src="'+x.logo+'" alt=""></span>';}
  function platformCard(x,mode){
    return '<article class="platform-card"><div class="platform-card-top">'+platformLogo(x)+'<div><h3>'+x.name+'</h3><p>Not connected</p></div></div><p>'+x.description+'</p><div class="card-footer"><span class="card-status">Developer credentials needed</span>'+button(mode==="overview"?"Explore":"Setup instructions","setup:"+x.id,"secondary-button")+'</div></article>';
  }
  function cards(){return '<div class="grid-4">'+social.map(function(s){return platformCard(s,"overview");}).join("")+'</div>';}
  function panelEmpty(title,description,action,ic){
    return '<section class="empty-panel"><div class="empty-icon">'+icon(ic||"chart-no-axes-combined")+'</div><h2>'+e(title)+'</h2><p>'+e(description)+'</p>'+button("Connect an account",action||"connections","primary-button","plus")+'</section>';
  }
  function overview(){
    return heading("Overview","A clear view of your connected social channels.",button("Connect account","connections","primary-button","plus"))+
      panelEmpty("Your SocialHub workspace is ready","Connect at least one social account to load real profile information, content and available analytics.","connections","sparkles")+
      '<div class="section-heading"><div><h2>Your platforms</h2><p>Keep all your channels in one place.</p></div></div>'+cards()+
      '<div class="section-heading"><div><h2>Made for your workflow</h2><p>Everything organised around your content.</p></div></div>'+
      '<div class="grid-3">'+mini("chart-no-axes-combined","Channel analytics","View metrics after you connect a supported account.")+mini("users-round","Audience insights","Understand your audience across platforms.")+mini("files","Content library","Review your recent posts and videos.")+'</div>';
  }
  function mini(ic,title,desc){return '<article class="card mini-card"><span class="mini-card-icon">'+icon(ic)+'</span><div><strong>'+e(title)+'</strong><p>'+e(desc)+'</p></div></article>';}
  function connections(){
    return heading("Connections","Connect and manage your social media accounts.",button("Connect account","setup:facebook","primary-button","plus"))+
      '<div class="grid-2">'+social.map(function(s){return platformCard(s,"connections");}).join("")+'</div>'+
      '<div class="info-strip">SocialHub should connect through each platform’s official OAuth flow. Never enter a social network password into a third-party connection form. Platform authentication requires server-side credentials and is not included in this static GitHub version.</div>'+
      '<div class="section-heading"><div><h2>What each connection can access</h2><p>Available data depends on account type, API approval and permissions.</p></div></div>'+
      '<div class="card panel">'+social.map(function(s){return '<div class="connection-row"><span class="check-dot">'+icon("check")+'</span><div><strong>'+s.name+'</strong><p>'+e(s.requirement)+'</p></div></div>';}).join("")+'</div>';
  }
  function platform(p){
    var s=social.find(function(v){return v.id===p;});
    return heading(s.name,s.description,button("Connection details","setup:"+s.id,"primary-button","link-2"))+
      panelEmpty(s.name+" is not connected","When a supported account is connected, its real metrics, content and insights will appear here.","setup:"+s.id,"chart-no-axes-combined")+
      '<div class="section-heading"><div><h2>About this connection</h2><p>What you need to get started.</p></div></div>'+
      '<div class="grid-2"><section class="card panel"><h3>Account requirements</h3><p>'+e(s.requirement)+'</p>'+button("View setup instructions","setup:"+s.id,"secondary-button","book-open")+'</section><section class="card panel"><h3>Data you can explore</h3><p>'+e(s.description)+' Availability is determined by official platform API permissions.</p></section></div>';
  }
  function analyse(p){
    var audience=p==="audience";
    var label=audience?"Audience":"Content";
    return heading(label,audience?"Understand your audience across connected channels.":"Your recent content and performance in one workspace.",button("Manage connections","connections","primary-button","link-2"))+
      panelEmpty(audience?"Audience insights will appear here":"Your content workspace is ready",audience?"Connect an account with audience insight permissions to see available demographic and growth data.":"Connect a platform to see the content and performance data its API allows.","connections",audience?"users-round":"files")+
      '<div class="section-heading"><div><h2>'+label+' overview</h2><p>Live results will appear once integrations are configured.</p></div></div>'+
      '<div class="grid-3">'+mini("chart-line","Trends","Visualise changes over time.")+mini("list-filter","Compare platforms","See supported data side by side.")+mini("shield-check","Privacy first","Only show data from accounts you authorise.")+'</div>';
  }
  function settings(){
    return heading("Settings","Manage your private workspace and preferences.","")+
      '<div class="grid-2"><section class="card panel"><div class="section-heading" style="margin-top:0"><div><h2>Account settings</h2><p>Personalise your workspace</p></div></div><div class="account-surface"><span class="avatar" data-avatar>'+avatarInitials()+'</span><div><strong data-profile-name>'+e(profile.name)+'</strong><p>Private workspace</p></div></div>'+button("Edit profile","profile","secondary-button","pencil")+'</section>'+
      '<section class="card panel"><div class="section-heading" style="margin-top:0"><div><h2>Appearance</h2><p>Your experience, your way.</p></div></div>'+
      settingToggle("compact","Compact overview cards","Reduce the spacing in your overview.")+
      settingToggle("hideTips","Hide onboarding hints","Show fewer setup reminders on Overview.")+'</section></div>'+
      '<div class="section-heading"><div><h2>Privacy & connections</h2><p>Your account controls</p></div></div>'+
      '<section class="card panel"><div class="setting-row"><div><strong>Connected accounts</strong><p>View all platform integration requirements in one place.</p></div>'+button("Manage","connections","secondary-button","link-2")+'</div><div class="setting-row"><div><strong>Local personalisation</strong><p>Profile details and preferences are stored on this browser in the static app.</p></div>'+button("Clear local data","clear-local","secondary-button","trash-2")+'</div></section>';
  }
  function settingToggle(id,title,desc){
    return '<div class="setting-row"><div><strong>'+e(title)+'</strong><p>'+e(desc)+'</p></div><button class="switch" type="button" role="switch" aria-label="'+e(title)+'" aria-checked="'+!!prefs[id]+'" data-pref="'+id+'"></button></div>';
  }
  function render(){
    var current=page();el("breadcrumb-page").textContent=titles[current];document.title=titles[current]+" · SocialHub";
    document.querySelectorAll(".nav-item").forEach(function(n){var selected=n.dataset.page===current;n.classList.toggle("active",selected);if(selected)n.setAttribute("aria-current","page");else n.removeAttribute("aria-current");});
    var main=el("main-content");
    var html= current==="overview"?overview():current==="connections"?connections():current==="settings"?settings():current==="audience"||current==="content"?analyse(current):platform(current);
    main.innerHTML=html;
    if(current==="overview"&&prefs.hideTips){var empty=main.querySelector(".empty-panel");if(empty)empty.hidden=true;}
    document.body.classList.toggle("compact-cards",!!prefs.compact);
    syncProfile();lucideRefresh();
  }
  function openMenu(anchor){
    var menu=el("profile-menu"),rect=anchor.getBoundingClientRect();
    if(!menu.hidden&&menu.dataset.from===anchor.id){closeMenu();return;}
    menu.hidden=false;menu.dataset.from=anchor.id;
    var left=anchor.id==="sidebar-profile"?rect.left+8:rect.right-menu.offsetWidth;
    var top=anchor.id==="sidebar-profile"?rect.top-menu.offsetHeight-6:rect.bottom+12;
    menu.style.left=Math.min(Math.max(12,left),window.innerWidth-menu.offsetWidth-12)+"px";
    menu.style.top=Math.max(12,Math.min(window.innerHeight-menu.offsetHeight-12,top))+"px";
    el("topbar-profile").setAttribute("aria-expanded","true");
  }
  function closeMenu(){el("profile-menu").hidden=true;el("topbar-profile").setAttribute("aria-expanded","false");}
  function closeMobile(){el("sidebar").classList.remove("open");el("mobile-shade").hidden=true;el("mobile-menu").setAttribute("aria-expanded","false");}
  function openModal(content){closeMenu();el("modal-content").innerHTML=content;el("modal-overlay").hidden=false;document.body.style.overflow="hidden";lucideRefresh();var field=el("profile-name-input");if(field)field.focus();}
  function closeModal(){el("modal-overlay").hidden=true;el("modal-content").innerHTML="";document.body.style.overflow="";}
  function profileModal(){
    var photo=profile.photo?'style="background-image:url('+profile.photo+')"':"";
    openModal('<p class="eyebrow">Personalisation</p><h2 id="dialog-title">My Profile</h2><p class="dialog-desc">Update how you appear in your private workspace.</p>'+
      '<div class="photo-box"><span class="avatar avatar-big" id="profile-preview" '+photo+'>'+ (profile.photo?"":e(avatarInitials()))+'</span><div class="photo-controls"><label class="secondary-button" for="profile-photo-input">'+icon("camera")+'Upload photo</label><input class="file-input" id="profile-photo-input" accept="image/png,image/jpeg,image/webp" type="file"><button class="text-button" data-action="remove-photo" type="button">Remove photo</button><small>PNG, JPG or WebP. Image is resized before saving.</small></div></div>'+
      '<label class="field-label" for="profile-name-input">Display name</label><input class="text-input" maxlength="48" id="profile-name-input" autocomplete="nickname" value="'+e(profile.name)+'">'+
      '<div class="dialog-footer">'+button("Cancel","close-modal","secondary-button")+button("Save changes","save-profile","primary-button")+'</div>');
  }
  function setupModal(id){
    var s=social.find(function(v){return v.id===id;});if(!s)return;
    openModal('<p class="eyebrow">Connect a platform</p><h2 id="dialog-title">'+s.name+' setup</h2><p class="dialog-desc">See what is required to connect your '+s.name+' account safely.</p>'+
      '<div class="card panel"><div class="platform-card-top" style="margin-bottom:15px">'+platformLogo(s)+'<strong>'+s.name+'</strong></div><p>'+e(s.requirement)+'</p><p>To enable real sign-in, configure your platform developer app, OAuth redirect URLs, scopes and a secure server-side token store. The static site does not request passwords or pretend to connect.</p></div>'+
      '<div class="dialog-footer">'+button("Close","close-modal","secondary-button")+'<a class="primary-button" href="'+s.docs+'" target="_blank" rel="noopener noreferrer">'+icon("external-link")+'Official API docs</a></div>');
  }
  function readPhoto(file){
    if(!file)return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)){notify("Please choose a PNG, JPG or WebP image.");return;}
    if(file.size>8*1024*1024){notify("Please choose a photo under 8 MB.");return;}
    var reader=new FileReader();
    reader.onload=function(){var img=new Image();img.onload=function(){var c=document.createElement("canvas"),size=256;c.width=size;c.height=size;var ctx=c.getContext("2d");var short=Math.min(img.width,img.height);ctx.drawImage(img,(img.width-short)/2,(img.height-short)/2,short,short,0,0,size,size);var url=c.toDataURL("image/jpeg",.82);var preview=el("profile-preview");if(preview){preview.style.backgroundImage='url("'+url+'")';preview.textContent="";preview.dataset.photo=url;}};img.src=reader.result;};reader.readAsDataURL(file);
  }
  function handleAction(action){
    if(!action)return;
    if(titles[action]){navigate(action);return;}
    if(action.indexOf("setup:")===0){setupModal(action.split(":")[1]);return;}
    if(action==="profile"){profileModal();return;}
    if(action==="close-modal"){closeModal();return;}
    if(action==="remove-photo"){var preview=el("profile-preview");if(preview){preview.style.backgroundImage="";preview.dataset.photo="";preview.textContent=avatarInitials();}return;}
    if(action==="save-profile"){var field=el("profile-name-input"),name=field.value.trim().replace(/\s+/g," ");if(!name){notify("Please enter a display name.");field.focus();return;}profile.name=name;var img=el("profile-preview");profile.photo=img&&img.dataset.photo!==undefined?img.dataset.photo:profile.photo;persist(KEY_PROFILE,profile);syncProfile();closeModal();render();notify("Profile updated on this device.");return;}
    if(action==="clear-local"){if(!window.confirm("Clear your saved profile photo, display name and interface preferences on this browser?"))return;try{localStorage.removeItem(KEY_PROFILE);localStorage.removeItem(KEY_PREFS);}catch(_){}profile=Object.assign({},defaults);prefs={hideTips:false,compact:false};render();notify("Local workspace data cleared.");return;}
    if(action==="signout"){closeMenu();notify("Sign out requires an authentication service. This is a local workspace preview.");return;}
  }
  function init(){
    document.addEventListener("click",function(ev){
      var nav=ev.target.closest("[data-page]");if(nav){navigate(nav.dataset.page);return;}
      var act=ev.target.closest("[data-action]");if(act){handleAction(act.dataset.action);return;}
      var opt=ev.target.closest("[data-pref]");if(opt){prefs[opt.dataset.pref]=!prefs[opt.dataset.pref];persist(KEY_PREFS,prefs);render();notify("Preference saved.");return;}
      var menuAction=ev.target.closest("[data-menu-action]");if(menuAction){handleAction(menuAction.dataset.menuAction);return;}
      var profileButton=ev.target.closest("#topbar-profile, #sidebar-profile");if(profileButton){openMenu(profileButton);return;}
      if(!ev.target.closest("#profile-menu"))closeMenu();
    });
    document.addEventListener("change",function(ev){if(ev.target.id==="profile-photo-input")readPhoto(ev.target.files[0]);});
    el("refresh-button").addEventListener("click",function(){render();notify("Workspace refreshed. No accounts connected yet.");});
    el("mobile-menu").addEventListener("click",function(){var opened=el("sidebar").classList.toggle("open");el("mobile-shade").hidden=!opened;el("mobile-menu").setAttribute("aria-expanded",String(opened));closeMenu();});
    el("mobile-shade").addEventListener("click",closeMobile);
    el("modal-close").addEventListener("click",closeModal);
    el("modal-overlay").addEventListener("click",function(ev){if(ev.target===this)closeModal();});
    document.addEventListener("keydown",function(ev){if(ev.key==="Escape"){closeModal();closeMenu();closeMobile();}if(ev.key==="Enter"&&el("profile-name-input")&&document.activeElement===el("profile-name-input"))handleAction("save-profile");});
    window.addEventListener("hashchange",function(){render();closeMobile();});
    window.addEventListener("resize",closeMenu);
    syncProfile();render();
    if("serviceWorker" in navigator && location.protocol==="https:")navigator.serviceWorker.register("./sw.js").catch(function(){});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
