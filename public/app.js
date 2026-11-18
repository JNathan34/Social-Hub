const PLATFORM = {
  facebook:{name:'Facebook',symbol:'f',cls:'fb',description:'Facebook Pages, post engagement and Page insights.',needs:'A Facebook Page with sufficient permissions and the Page ANALYZE task.'},
  instagram:{name:'Instagram',symbol:'◎',cls:'ig',description:'Instagram Creator and Business account profile, media and available insights.',needs:'A professional Instagram Creator or Business account. Personal accounts are not supported by this integration.'},
  tiktok:{name:'TikTok',symbol:'♪',cls:'tt',description:'TikTok profile statistics and recent public videos.',needs:'A TikTok Developer app approved for Login Kit, Display API and the requested scopes.'},
  youtube:{name:'YouTube',symbol:'▶',cls:'yt',description:'YouTube channel statistics, video performance and comment threads.',needs:'A Google OAuth app with YouTube Data API v3 and YouTube Analytics API enabled.'}
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('en-GB', {maximumFractionDigits:0});
const compact = n => n === null || n === undefined ? '—' : Intl.NumberFormat('en-GB',{notation:'compact',maximumFractionDigits:1}).format(Number(n)||0);
const dateFmt = v => { if(!v) return 'Date unavailable'; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); };
let state = null;
let currentPage = 'overview';
let currentPlatform = 'facebook';
let currentPeriod = 'monthly';
let currentMetric = 'views';
let contentFilter = 'all';
let contentSearch = '';
let chartPoints = [];
let refreshing = false;
let toastTimer;
let installPrompt = null;

async function api(url, options={}) {
  const res = await fetch(url, { ...options, headers:{ ...(options.body?{'Content-Type':'application/json'}:{}), ...(options.headers||{}) } });
  let data; try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); installPrompt=event; $('#installBtn').hidden=false;
});
$('#installBtn').addEventListener('click', async () => {
  if(!installPrompt) { notify('Use your browser menu and choose Install SocialHub or Add to Home Screen.'); return; }
  installPrompt.prompt(); await installPrompt.userChoice; installPrompt=null; $('#installBtn').hidden=true;
});
window.addEventListener('appinstalled', () => { $('#installBtn').hidden=true; notify('SocialHub has been installed.'); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
function notify(message, type='') { const node=$('#toast'); node.textContent=message; node.className=`toast show ${type}`; clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.className='toast',3200); }
function showNotice(message, type='') { const n=$('#notice'); n.textContent=message; n.className=`notice ${type}`; }
function hideNotice() { $('#notice').className='notice hidden'; }
function isConnected(platform) { return !!state?.accounts?.[platform]; }
function account(platform) { return state?.accounts?.[platform] || null; }
function snapshot(platform) { return account(platform)?.snapshot || null; }
function icon(name) { return `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`; }
function platformLogo(p) { return `<span class="platform-icon ${PLATFORM[p].cls}">${icon(p)}</span>`; }
function pageMeta() {
  const titles={overview:['Overview','A clear view of your connected social channels.'],facebook:['Facebook','Track your connected Facebook Page.'],instagram:['Instagram','Review your professional Instagram account.'],tiktok:['TikTok','See your TikTok profile and published videos.'],youtube:['YouTube','Channel analytics, recent videos and audience insights.'],audience:['Audience','Demographic information returned by connected platform APIs.'],content:['Content','Your recent content across all connected platforms.'],connections:['Connections','Connect and manage your social media accounts.'],settings:['Settings','Developer app setup and website security information.']};
  const [title,sub]=titles[currentPage]||titles.overview; $('#pageTitle').innerHTML=`${esc(title)}<span>.</span>`; $('#pageSubtitle').textContent=sub; $('#breadcrumb').textContent=title; $('#breadcrumb').dataset.currentPage=currentPage; $('#breadcrumb').dataset.page=currentPage; document.body.dataset.currentPage=currentPage; document.body.dataset.connected=PLATFORM[currentPage]&&isConnected(currentPage)?'yes':'no';
  document.querySelectorAll('[data-page].nav-link').forEach(b=>b.classList.toggle('active',b.dataset.page===currentPage));
}
function updateStatusDots() { document.querySelectorAll('[data-status]').forEach(el=>el.classList.toggle('on',isConnected(el.dataset.status))); }
function lastSyncText() {
  const stamps=Object.values(state?.accounts||{}).map(a=>a.lastSyncedAt).filter(Boolean).sort();
  $('#lastSync').textContent=stamps.length?`Last synced ${new Date(stamps.at(-1)).toLocaleString('en-GB',{dateStyle:'short',timeStyle:'short'})}`:'No accounts synced yet';
}
function metricIcon(value) { return icon(({'♙':'users','◉':'eye','↗':'chart','⌘':'connections','♥':'heart','▤':'video'})[value]||'chart'); }
function metricCard(label,value,meta='',icon='◉') {
  return `<article class="metric-card"><div class="metric-top"><span>${esc(label)}</span><span class="metric-icon">${metricIcon(icon)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-foot"><span class="neutral">${esc(meta)}</span></div></article>`;
}
function emptyBlock(title, text, buttonText='Connect an account', page='connections') {
  return `<div class="empty-state"><div class="empty-icon">${icon("sparkles")}</div><h3>${esc(title)}</h3><div>${esc(text)}</div><button class="button button-primary" style="margin-top:13px" data-page="${page}">${esc(buttonText)}</button></div>`;
}
function periodCut(points, period) {
  if (!points.length) return [];
  const sorted=[...points].sort((a,b)=>String(a.date||a.at).localeCompare(String(b.date||b.at)));
  if (period==='daily') return sorted.slice(-14);
  if (period==='monthly') return sorted.slice(-30);
  const map=new Map();
  for (const p of sorted) {
    const d = new Date(p.date || p.at); if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    // For daily analytics, add values inside each month. For point-in-time snapshots, keep the final snapshot.
    const val=Number(p.value ?? p.views ?? 0);
    const existing=map.get(key);
    if (p.isSnapshot) map.set(key,{date:`${key}-01`,value:val,label:d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'}),isSnapshot:true});
    else map.set(key,{date:`${key}-01`,value:(existing?.value||0)+val,label:d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'})});
  }
  return [...map.values()].slice(-12);
}
function rawChartPoints(platform='all', metric=currentMetric) {
  const platforms=platform==='all'?Object.keys(state?.accounts||{}):[platform];
  const rows=[];
  for (const p of platforms) {
    const snap=snapshot(p); const series=snap?.series || [];
    if (series.length) {
      for (const x of series) {
        let value=0;
        if (metric==='views') value=Number(x.views ?? x.reach ?? x.value ?? 0);
        else if (metric==='followers') value=Number(x.subscribers ?? x.followers ?? 0);
        else value=Number(x.likes||0)+Number(x.comments||0)+Number(x.engagement||0);
        rows.push({date:x.date,value,platform:p});
      }
    } else {
      for (const h of state?.history?.[p] || []) {
        const value = metric==='followers' ? h.followers : metric==='views' ? h.views : (Number(h.likes)||0)+(Number(h.comments)||0);
        if (value!==null && value!==undefined) rows.push({at:h.at,value:Number(value)||0,platform:p,isSnapshot:true});
      }
    }
  }
  if (platform==='all') {
    const aggregate=new Map();
    for (const row of rows) {
      const key=(row.date||row.at||'').slice(0,10);
      if (!key) continue;
      const prev=aggregate.get(key)||{date:key,value:0,isSnapshot:!!row.isSnapshot};
      prev.value += row.value; prev.isSnapshot = prev.isSnapshot && !!row.isSnapshot; aggregate.set(key,prev);
    }
    return [...aggregate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  return rows.sort((a,b)=>String(a.date||a.at).localeCompare(String(b.date||b.at)));
}
function buildChart(platform='all') {
  const all=rawChartPoints(platform,currentMetric);
  chartPoints=periodCut(all,currentPeriod);
  const titleMetric=currentMetric==='views'?(platform==='facebook'?'Reach':'Views'):currentMetric==='followers'?'Followers / subscribers':'Engagement actions';
  const unit=currentMetric==='followers'?'account count':'reported events';
  const chartHasValues=chartPoints.length>0;
  const title=`${titleMetric} over time`;
  const canUseAPI=platform==='youtube'||platform==='facebook';
  const trendNote=chartHasValues?(all.some(x=>!x.isSnapshot)?'Platform analytics API data':'SocialHub observations collected after account connection'):'No time-series data available yet';
  const max=Math.max(1,...chartPoints.map(x=>Number(x.value)||0));
  const min=Math.min(0,...chartPoints.map(x=>Number(x.value)||0));
  const w=900,h=220,left=10,right=888,top=18,bottom=178;
  const pts=chartPoints.map((p,i)=>({x:left+(chartPoints.length===1?0:i*(right-left)/(chartPoints.length-1)),y:bottom-((Number(p.value)-min)/(max-min||1))*(bottom-top),...p}));
  const line=pts.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area=pts.length?`${line} L ${pts.at(-1).x},${bottom} L ${pts[0].x},${bottom} Z`:'';
  const dateLabel=p=>{ const d=new Date(p.date||p.at); return Number.isNaN(d.getTime())?'—':currentPeriod==='yearly'?d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'}):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}); };
  const labelIndexes=pts.length>6?[0,Math.floor((pts.length-1)/3),Math.floor((pts.length-1)*2/3),pts.length-1]:pts.map((_,i)=>i);
  const svg=chartHasValues?`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}"><defs><linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#a78bfa" stop-opacity=".28"/><stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/></linearGradient></defs>${[20,60,100,140,178].map(y=>`<line class="chart-grid" x1="0" y1="${y}" x2="900" y2="${y}"/>`).join('')}<path class="chart-fill" d="${area}"/><path class="chart-line" d="${line}"/>${pts.map((p,i)=>`<circle class="chart-point" data-point="${i}" cx="${p.x}" cy="${p.y}" r="${i===pts.length-1?5:3.2}"/>`).join('')}<text class="chart-label" x="10" y="208">${esc(dateLabel(pts[0]))}</text>${labelIndexes.slice(1,-1).map(i=>`<text class="chart-label" text-anchor="middle" x="${pts[i].x}" y="208">${esc(dateLabel(pts[i]))}</text>`).join('')}<text class="chart-label" text-anchor="end" x="890" y="208">${esc(dateLabel(pts.at(-1)))}</text></svg>`:`<div class="empty-state" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center"><div class="empty-icon">${icon("chart")}</div><h3>Trend history starts here</h3><div>Refresh connected accounts periodically to build your own history.<br>Some platforms also provide their own historical analytics.</div></div>`;
  return `<section class="chart-panel"><div class="chart-head"><div><div class="panel-title">${title}</div><div class="panel-subtitle">${esc(unit)} · ${platform==='all'?'combined connected accounts':PLATFORM[platform].name}</div></div><div class="chart-tools"><div class="segmented" id="metricTabs">${[['views','Views'],['followers','Followers'],['engagement','Engagement']].map(([v,l])=>`<button data-metric="${v}" class="${currentMetric===v?'active':''}">${l}</button>`).join('')}</div><div class="segmented" id="periodTabs">${[['daily','Daily'],['monthly','Monthly'],['yearly','Yearly']].map(([v,l])=>`<button data-period="${v}" class="${currentPeriod===v?'active':''}">${l}</button>`).join('')}</div></div></div><div class="chart-key"><i></i>${titleMetric}</div><div class="chart-area" id="chartArea">${svg}<div class="chart-tooltip" id="chartTooltip"></div></div><div class="chart-foot"><span>${esc(trendNote)}</span><strong>${chartHasValues?`${chartPoints.length} data points`:'Waiting for available metrics'}</strong></div></section>`;
}
function platformRows() {
  return Object.keys(PLATFORM).map(p=>{
    const a=account(p); const m=a?.snapshot?.metrics; const prof=a?.snapshot?.profile||a?.profile;
    const count=m?.followers ?? prof?.followers ?? prof?.subscribers;
    return `<button class="platform-row" data-page="${p}">${platformLogo(p)}<span class="platform-row-copy"><strong>${PLATFORM[p].name}</strong><small>${a?esc(prof?.name||'Connected account'):'Not connected'}</small></span><span class="platform-row-value"><strong>${a?compact(count):'—'}</strong><small>${a?'Followers / subscribers':'Connect to load data'}</small></span><span class="status-pill ${a?'':'off'}">${a?'Connected':'Connect'}</span></button>`;
  }).join('');
}
function contentCard(item) {
  const p=PLATFORM[item.platform]; const title=item.title||'Untitled content';
  const thumb=item.thumbnail?`<img src="${esc(item.thumbnail)}" alt="" loading="lazy" onerror="this.remove()">`:`<span class="thumb-fallback">${icon(item.platform)}</span>`;
  return `<article class="content-card" role="button" tabindex="0" data-content-id="${esc(item.id)}" data-content-platform="${item.platform}"><div class="content-thumb">${thumb}<span class="platform-badge">${p.name}</span><span class="play-indicator">${icon("play")}</span></div><div class="content-info"><h3>${esc(title)}</h3><p>${esc(dateFmt(item.publishedAt))} · ${esc(item.mediaType||'Post')}</p><div class="content-stats"><span>${icon("eye")} <b>${item.views===null||item.views===undefined?'—':compact(item.views)}</b></span><span>${icon("heart")} <b>${item.likes===null||item.likes===undefined?'—':compact(item.likes)}</b></span><span>${icon("content")} <b>${item.comments===null||item.comments===undefined?'—':compact(item.comments)}</b></span></div></div></article>`;
}
function topContent(platform='all', limit=6) {
  let items=platform==='all'?(state?.content||[]):(snapshot(platform)?.content||[]);
  return [...items].sort((a,b)=>(Number(b.views)||Number(b.likes)||0)-(Number(a.views)||Number(a.likes)||0)).slice(0,limit);
}
function contentGrid(items) { return items.length?`<div class="content-grid">${items.map(contentCard).join('')}</div>`:emptyBlock('No content to show yet','Connect an account and refresh it. SocialHub will display recent posts and videos returned by the official platform API.','Connect accounts'); }
function overviewPage() {
  const connected=Object.keys(state?.accounts||{}).length; const totals=state?.totals||{};
  if (!connected) return `${emptyBlock('Your SocialHub workspace is ready','Connect at least one social account to load real profile information, content and available analytics.')}`;
  const content=topContent('all',6);
  return `<div class="metric-grid">${metricCard('Audience across accounts',compact(totals.followers),'Sum of platform follower counts','♙')}${metricCard('Reported views',compact(totals.views),'As reported by connected APIs','◉')}${metricCard('Likes + comments',compact((totals.likes||0)+(totals.comments||0)),'Available recent content totals','↗')}${metricCard('Connected platforms',`${totals.connectedPlatforms}/4`,'Authorised accounts','⌘')}</div><div class="overview-grid">${buildChart('all')}<section class="panel"><div class="panel-head"><div><div class="panel-title">Connected platforms</div><div class="panel-subtitle">Account status and audience size</div></div><button class="text-link" data-page="connections">Manage ↗</button></div><div class="platform-list">${platformRows()}</div></section></div><div class="section-heading"><div><h2>Top performing content</h2><p>Ranked using view counts where the platform API supplies them.</p></div><button class="text-link" data-page="content">View content ${icon("arrow-right")}</button></div>${contentGrid(content)}<div class="info-box">Combined follower totals are the sum of each connected account's audience count, not a deduplicated count of unique people. Metrics and reporting windows differ by platform.</div>`;
}
function platformPage(p) {
  const a=account(p); const s=snapshot(p); const m=s?.metrics; const profile=s?.profile || a?.profile;
  if(!a) return `<div class="connection-layout"><section class="empty-state connection-hero"><div class="empty-icon platform-${p}">${icon(p)}</div><div class="eyebrow">ACCOUNT CONNECTION</div><h3>Connect your ${PLATFORM[p].name} account</h3><div>Bring your ${PLATFORM[p].name} analytics, audience information and recent content into your SocialHub dashboard.</div>${state?.config?.find(x=>x.platform===p)?.configured ? `<a class="button button-primary" href="/auth/${p}/start">${icon('plus')} Connect ${PLATFORM[p].name}</a>` : `<button class="button button-primary" data-page="settings">${icon('settings')} Configure ${PLATFORM[p].name}</button>`}<p class="connect-helper">Only the permissions you approve will be requested.</p></section><aside class="panel setup-panel"><span class="setup-label">GETTING STARTED</span><h2>Before you connect</h2><p class="setup-intro">A quick checklist to make sure your connection works.</p><div class="setup-item"><span class="setup-step">1</span><div><strong>Check account eligibility</strong><p>${esc(PLATFORM[p].needs)}</p></div></div><div class="setup-item"><span class="setup-step">2</span><div><strong>Configure the developer app</strong><p>Add the OAuth credentials and callback URL in Settings.</p></div></div><div class="setup-item"><span class="setup-step">3</span><div><strong>Authorise and sync</strong><p>Sign in through the platform and let SocialHub load the available metrics.</p></div></div><button class="text-link" data-page="settings">View connection setup ${icon('arrow-right')}</button></aside></div>`;
  const followers=m?.followers ?? profile?.followers ?? profile?.subscribers;
  const contentCount=m?.contentCount ?? profile?.videos ?? null;
  const content=topContent(p,6);
  const warnings=(s?.warnings||[]).map(x=>`<div class="info-box">${esc(x)}</div>`).join('');
  const syncError=a.syncError?`<div class="warning-box">Last refresh failed: ${esc(a.syncError)}. Your last successful snapshot remains visible.</div>`:'';
  return `<div class="panel platform-head-card"><div>${profile?.avatar?`<img class="profile-avatar" src="${esc(profile.avatar)}" alt="">`:`<div class="profile-avatar placeholder">${icon(p)}</div>`}</div><div class="profile-head-copy"><h2>${esc(profile?.name||PLATFORM[p].name)}</h2><a href="${esc(profile?.url||'#')}" target="_blank" rel="noreferrer">${profile?.username?'@'+esc(profile.username):esc(profile?.url||'Open profile')} ↗</a></div><div class="last-sync-inline">${a.lastSyncedAt?'Updated '+esc(dateFmt(a.lastSyncedAt)):'Not synced'}</div><button class="small-button primary" data-refresh-platform="${p}">${icon("refresh")} Refresh data</button></div><div class="metric-grid">${metricCard('Followers / subscribers',fmt(followers),'Current account total','♙')}${metricCard(p==='facebook'?'Reach':'Reported views',p==='facebook'?(m?.reach===undefined?'—':compact(m.reach)):(m?.views===undefined?'—':compact(m.views)),p==='facebook'?'Unique Page impressions':'Available through this API','◉')}${metricCard('Likes',m?.likes===undefined?'—':compact(m.likes),'Profile or recent content','♥')}${metricCard('Posts / videos',fmt(contentCount),'Published content count','▤')}</div>${buildChart(p)}${warnings}${syncError}<div class="section-heading"><div><h2>Top performing ${PLATFORM[p].name} content</h2><p>Recent posts and videos returned by the connected account.</p></div><button class="text-link" data-page="content" data-filter-platform="${p}">Open content library ${icon("arrow-right")}</button></div>${contentGrid(content)}`;
}
function contentPage() {
  let items=[...(state?.content||[])];
  if(contentFilter!=='all') items=items.filter(x=>x.platform===contentFilter);
  if(contentSearch) items=items.filter(x=>(`${x.title} ${x.description} ${PLATFORM[x.platform]?.name||''}`).toLowerCase().includes(contentSearch.toLowerCase()));
  items.sort((a,b)=>(Number(b.views)||Number(b.likes)||0)-(Number(a.views)||Number(a.likes)||0));
  return `<div class="toolbar"><div class="segmented">${[['all','All'],...Object.keys(PLATFORM).map(p=>[p,PLATFORM[p].name])].map(([v,l])=>`<button data-content-filter="${v}" class="${contentFilter===v?'active':''}">${l}</button>`).join('')}</div><input class="search-input" id="contentSearch" placeholder="Search content…" value="${esc(contentSearch)}"></div><div class="panel-subtitle" style="margin:0 0 12px">${items.length} items returned by connected accounts. Select a card to open its video or post details.</div>${contentGrid(items)}<div class="info-box">SocialHub shows only content returned by each platform's approved API scopes. TikTok Display API provides public video information but does not provide comment threads. Facebook and Instagram comment access requires additional approved permissions.</div>`;
}
function audiencePage() {
  const reports=[];
  for(const p of Object.keys(PLATFORM)) { const demo=snapshot(p)?.demographics; if(demo?.rows?.length) reports.push({platform:p,...demo}); }
  if(!reports.length) return emptyBlock('No demographic reports available yet','Audience demographics are restricted and are not exposed equally by each platform. Connect an eligible account with approved analytics permissions. YouTube demographic reports can take time to become available.','Manage connections');
  return reports.map(rep=>{
    const headers=(rep.headers||[]).map(x=>x.name); const rows=rep.rows||[];
    return `<section class="panel" style="margin-bottom:13px"><div class="panel-head"><div><div class="panel-title">${PLATFORM[rep.platform].name} audience demographics</div><div class="panel-subtitle">Returned directly by the ${PLATFORM[rep.platform].name} Analytics API</div></div><span class="status-pill">API data</span></div><div class="table-scroll"><table class="demographics-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((c,i)=>`<td>${esc(i===0||i===1?c:(Number(c)||0).toFixed(2))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }).join('');
}
function connectionsPage() {
  const cards=Object.keys(PLATFORM).map(p=>{
    const config=state.config.find(x=>x.platform===p); const a=account(p); const prof=a?.snapshot?.profile||a?.profile;
    const status=a?`Connected · ${esc(prof?.name||'Account authorised')}`:config?.configured?'Ready to connect':'Developer credentials needed';
    const action=a?`<button class="small-button" data-refresh-platform="${p}">Refresh</button><button class="small-button danger" data-disconnect="${p}">Disconnect</button>`:config?.configured?`<a class="small-button primary" href="/auth/${p}/start">Connect ${PLATFORM[p].name}</a>`:`<button class="small-button" data-page="settings">Setup instructions</button>`;
    const pagePicker=p==='facebook'&&a?.pageOptions?.length>1?`<div class="connect-meta">Page: <select class="page-select" id="facebookPageSelect">${a.pageOptions.map(x=>`<option value="${esc(x.id)}" ${x.id===a.selectedPageId?'selected':''}>${esc(x.name)}</option>`).join('')}</select> <button class="small-button" data-select-facebook-page>Use Page</button></div>`:'';
    return `<article class="connect-card"><div class="connect-logo ${PLATFORM[p].cls}">${icon(p)}</div><div class="connect-body"><h3>${PLATFORM[p].name}</h3><p>${PLATFORM[p].description}</p><div class="connect-meta">${status}</div>${pagePicker}<div class="connect-actions">${action}</div></div></article>`;
  }).join('');
  return `<div class="connect-grid">${cards}</div><div class="warning-box">Connections use each platform's official sign-in page. SocialHub never asks for or stores your social media password. Tokens are encrypted on this server. Disconnecting removes the stored token and cached data from this local app.</div><div class="section-heading"><div><h2>What each connection can access</h2><p>Available data depends on account type, API approval and granted permissions.</p></div></div><div class="panel"><div class="config-list">${Object.keys(PLATFORM).map(p=>`<div class="config-row"><div class="config-check">✓</div><div class="config-copy"><strong>${PLATFORM[p].name}</strong><p>${esc(PLATFORM[p].needs)}</p></div></div>`).join('')}</div></div>`;
}
function settingsPage() {
  const rows=state.config.map(c=>`<div class="config-row"><div class="config-check ${c.configured?'':'off'}">${c.configured?'✓':'!'}</div><div class="config-copy"><strong>${c.name} OAuth app ${c.configured?'configured':'not configured'}</strong><p>Register this exact callback URL in your platform developer console:</p><span class="code-path">${esc(c.callbackUrl)}</span></div></div>`).join('');
  return `<div class="panel"><div class="panel-head"><div><div class="panel-title">Developer credentials</div><div class="panel-subtitle">Set these in your hosting provider environment (or your private local .env file), then restart/redeploy SocialHub.</div></div><span class="status-pill">Server-side only</span></div><div class="config-list">${rows}</div><div class="warning-box">Never paste app secrets or access tokens into the browser, frontend files, GitHub or chat. Put credentials only in private server environment variables or your local .env file. SocialHub never returns them to the browser.</div></div><div class="section-heading"><div><h2>Developer setup guides</h2><p>Official platform documentation and app registration.</p></div></div><div class="panel"><table class="setting-table"><tr><td>Facebook</td><td><a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Meta for Developers ↗</a><br>Enable Facebook Login and request Pages permissions.</td></tr><tr><td>Instagram</td><td><a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Meta for Developers ↗</a><br>Configure Instagram API with Instagram Login for a professional account.</td></tr><tr><td>TikTok</td><td><a href="https://developers.tiktok.com/" target="_blank" rel="noreferrer">TikTok for Developers ↗</a><br>Enable Login Kit (Web) and Display API. The registered redirect URI must use HTTPS.</td></tr><tr><td>YouTube</td><td><a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console ↗</a><br>Enable YouTube Data API v3 and YouTube Analytics API; create a Web OAuth client.</td></tr></table></div><div class="section-heading"><div><h2>How SocialHub handles data</h2><p>Private single-owner workspace.</p></div></div><div class="panel"><div class="config-list"><div class="config-row"><div class="config-check">✓</div><div class="config-copy"><strong>Encrypted platform tokens</strong><p>OAuth access and refresh tokens are encrypted using AES-256-GCM before they are saved to the private server data store.</p></div></div><div class="config-row"><div class="config-check">✓</div><div class="config-copy"><strong>Server-only secrets</strong><p>Provider client secrets are only read from private server environment variables by the Node.js backend.</p></div></div><div class="config-row"><div class="config-check">✓</div><div class="config-copy"><strong>Owner-password protected</strong><p>The website requires the private workspace password before any account data or OAuth routes can be accessed. Use HTTPS for hosted deployments.</p></div></div></div></div>`;
}
function render() {
  if(!state) return;
  pageMeta(); updateStatusDots(); lastSyncText(); updateProfileUI();
  const content=$('#pageContent');
  if(currentPage==='overview') content.innerHTML=overviewPage();
  else if(PLATFORM[currentPage]) content.innerHTML=platformPage(currentPage);
  else if(currentPage==='content') content.innerHTML=contentPage();
  else if(currentPage==='audience') content.innerHTML=audiencePage();
  else if(currentPage==='connections') content.innerHTML=connectionsPage();
  else if(currentPage==='settings') content.innerHTML=settingsPage();
  else content.innerHTML=overviewPage();
  bindChart();
}
function bindChart() {
  document.querySelectorAll('[data-period]').forEach(b=>b.addEventListener('click',()=>{currentPeriod=b.dataset.period;render();}));
  document.querySelectorAll('[data-metric]').forEach(b=>b.addEventListener('click',()=>{currentMetric=b.dataset.metric;render();}));
  const area=$('#chartArea'), tooltip=$('#chartTooltip');
  if(area&&tooltip) area.querySelectorAll('[data-point]').forEach(dot=>{
    const show=()=>{const p=chartPoints[Number(dot.dataset.point)];if(!p)return;tooltip.textContent=`${dateFmt(p.date||p.at)} · ${fmt(p.value)}`;tooltip.style.display='block';tooltip.style.left=`${(Number(dot.getAttribute('cx'))/900)*100}%`;tooltip.style.top=`${(Number(dot.getAttribute('cy'))/220)*100}%`;};
    dot.addEventListener('mouseenter',show);dot.addEventListener('focus',show);dot.addEventListener('mouseleave',()=>tooltip.style.display='none');dot.addEventListener('blur',()=>tooltip.style.display='none');
  });
}
function showContentModal(platform,id) {
  const item=(state?.content||[]).find(x=>x.platform===platform&&String(x.id)===String(id));
  if(!item) return;
  const p=PLATFORM[platform]; const embed=item.embedUrl || '';
  let media='';
  if(embed && ['youtube','tiktok','instagram','facebook'].includes(platform)) media=`<iframe src="${esc(embed)}" title="${esc(item.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>`;
  else if(item.thumbnail) media=`<img src="${esc(item.thumbnail)}" alt="${esc(item.title)}">`;
  else media=`<div class="media-placeholder"><div style="font-size:30px">${icon(platform)}</div><strong>Preview not available</strong><a href="${esc(item.permalink||'#')}" target="_blank" rel="noreferrer">Open on ${p.name} ↗</a></div>`;
  $('#modalBody').innerHTML=`<div class="modal-heading"><div class="eyebrow">${p.name.toUpperCase()} CONTENT</div><h2 id="modalTitle">${esc(item.title||'Untitled content')}</h2><p>${esc(dateFmt(item.publishedAt))} · ${esc(item.mediaType||'Content')} · <a href="${esc(item.permalink||'#')}" target="_blank" rel="noreferrer">Open original ↗</a></p></div><div class="modal-layout"><div><div class="media-stage">${media}</div><div class="modal-stats">${[['Views',item.views],['Likes',item.likes],['Comments',item.comments],['Shares',item.shares],['Published',dateFmt(item.publishedAt)],['Platform',p.name]].map(([l,v])=>`<div class="modal-stat"><span>${esc(l)}</span><strong>${esc(typeof v==='number'?compact(v):v===null||v===undefined?'—':String(v))}</strong></div>`).join('')}</div><div class="media-desc">${esc(item.description||'No caption was returned by the platform.')}</div></div><section class="comments-panel"><div class="comments-head"><strong>Comments</strong><span id="commentsStatus">Loading from ${p.name}…</span></div><div class="comments-list" id="commentsList"><div class="comment-note">Loading comments from the official platform API…</div></div></section></div>`;
  $('#contentModal').classList.remove('hidden'); $('#contentModal').setAttribute('aria-hidden','false');
  loadComments(platform,id);
}
async function loadComments(platform,id) {
  const list=$('#commentsList'), status=$('#commentsStatus');
  try {
    const data=await api(`/api/comments/${encodeURIComponent(platform)}/${encodeURIComponent(id)}`);
    if(data.unavailable) { status.textContent='Not exposed by API'; list.innerHTML=`<div class="comment-note">${esc(data.message)}<br><br><a href="${esc((state.content||[]).find(x=>x.platform===platform&&String(x.id)===String(id))?.permalink||'#')}" target="_blank" rel="noreferrer">Open original post ↗</a></div>`; return; }
    const comments=data.comments||[]; status.textContent=`${comments.length} comments · API data`;
    list.innerHTML=comments.length?comments.map(c=>`<div class="comment"><div class="comment-avatar">${esc((c.author||'U').slice(0,1).toUpperCase())}</div><div class="comment-body"><strong>${esc(c.author||'User')}</strong><small>${esc(dateFmt(c.publishedAt))}${c.likes?` · ♥ ${fmt(c.likes)}`:''}</small><p>${esc(c.text||'')}</p></div></div>`).join(''):`<div class="comment-note">No comments were returned. This may mean there are no public comments, or the account has not granted comment-reading permissions.</div>`;
  } catch(e) { status.textContent='Comments unavailable'; list.innerHTML=`<div class="comment-note">${esc(e.message)}<br><br>Check the API permissions for this platform or open the original post to view its comments.</div>`; }
}
async function loadState() { state=await api('/api/state'); render(); }
async function refresh(platform=null) {
  if(refreshing) return; refreshing=true; $('#refreshBtn').disabled=true; $('#refreshBtn').classList.add('is-refreshing'); $('#refreshBtn').setAttribute('aria-busy','true');
  try {
    const data=await api('/api/refresh',{method:'POST',body:JSON.stringify(platform?{platform}:{})});
    state=data.state; render();
    const fails=(data.results||[]).filter(x=>!x.ok);
    if(fails.length) notify(`Refresh finished with ${fails.length} issue(s). Check platform pages for details.`,'error');
    else notify(platform?`${PLATFORM[platform].name} refreshed`:'Connected accounts refreshed');
  } catch(e) { notify(e.message,'error'); }
  finally { refreshing=false; $('#refreshBtn').disabled=false; $('#refreshBtn').classList.remove('is-refreshing'); $('#refreshBtn').removeAttribute('aria-busy'); }
}
async function disconnect(platform) {
  if(!confirm(`Disconnect ${PLATFORM[platform].name}? SocialHub will delete its saved token and cached analytics from this local app.`)) return;
  try { const result=await api(`/api/disconnect/${platform}`,{method:'POST',body:'{}'});state=result.state;render();notify(`${PLATFORM[platform].name} disconnected`); }
  catch(e){notify(e.message,'error');}
}
async function selectFacebookPage() {
  const id=$('#facebookPageSelect')?.value;if(!id)return;
  try { await api('/api/facebook/select-page',{method:'POST',body:JSON.stringify({pageId:id})});await refresh('facebook');notify('Facebook Page selected'); }
  catch(e){notify(e.message,'error');}
}
function navigate(page) { closeProfileMenu(); currentPage=page; contentSearch=''; render(); $('#sidebar').classList.remove('open');$('#scrim').classList.remove('show');window.scrollTo({top:0,behavior:'smooth'}); }
const profileMenu=$('#profileMenu');
const profileModal=$('#profileModal');
let profileAnchor=null;
let editedAvatar='';
function profileName() { return state?.profile?.name || 'Workspace owner'; }
function profileInitials() {
  if(!state?.profile || !state.profile.name || state.profile.name==='Workspace owner') return 'SH';
  return (state.profile.name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('') || 'SH').toUpperCase();
}
function renderAvatar(node, avatar, initials) {
  node.textContent='';
  if(avatar) {
    const img=document.createElement('img'); img.src=avatar; img.alt=''; img.className='avatar-image'; node.appendChild(img);
  } else node.textContent=initials;
}
function updateProfileUI() {
  document.querySelectorAll('[data-profile-name]').forEach(el=>el.textContent=profileName());
  document.querySelectorAll('[data-profile-avatar]').forEach(el=>renderAvatar(el,state?.profile?.avatar||'',profileInitials()));
  $('#headerProfileBtn').setAttribute('aria-label',`Open ${profileName()} profile menu`);
  $('#sidebarProfileBtn').setAttribute('aria-label',`Open ${profileName()} profile menu`);
}
function closeProfileMenu(restoreFocus=false) {
  profileMenu.classList.add('hidden');
  document.querySelectorAll('.profile-trigger').forEach(b=>b.setAttribute('aria-expanded','false'));
  if(restoreFocus && profileAnchor) profileAnchor.focus();
  profileAnchor=null;
}
function toggleProfileMenu(trigger) {
  if(!profileMenu.classList.contains('hidden') && profileAnchor===trigger) { closeProfileMenu(true); return; }
  profileAnchor=trigger;
  document.querySelectorAll('.profile-trigger').forEach(b=>b.setAttribute('aria-expanded',String(b===trigger)));
  profileMenu.classList.remove('hidden');
  const r=trigger.getBoundingClientRect(), width=280, edge=12;
  const left=Math.max(edge,Math.min(window.innerWidth-width-edge,r.right-width));
  profileMenu.style.left=left+'px';
  profileMenu.style.top='auto'; profileMenu.style.bottom='auto';
  if(trigger.id==='sidebarProfileBtn') {
    const bottom=window.innerHeight-r.top+10;
    profileMenu.style.bottom=Math.min(bottom,window.innerHeight-280)+'px';
  } else profileMenu.style.top=(r.bottom+12)+'px';
  profileMenu.querySelector('[data-profile-action="edit"]').focus();
}
function openProfileDialog() {
  closeProfileMenu(); $('#sidebar').classList.remove('open');$('#scrim').classList.remove('show');
  editedAvatar=state?.profile?.avatar||'';
  $('#profileDisplayName').value=profileName();
  renderAvatar($('#profileEditAvatar'),editedAvatar,profileInitials());
  $('#profileFormError').textContent='';
  $('#profilePhotoFile').value='';
  profileModal.classList.remove('hidden');
  profileModal.setAttribute('aria-hidden','false');
  $('#profileDisplayName').focus();
}
function closeProfileDialog() {
  profileModal.classList.add('hidden');
  profileModal.setAttribute('aria-hidden','true');
}
async function readAndResizeProfilePicture(file) {
  if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG or WebP image.');
  if(file.size>5*1024*1024) throw new Error('Choose an image smaller than 5 MB.');
  const local=URL.createObjectURL(file);
  try {
    const image=await new Promise((resolve,reject)=>{
      const img=new Image(); img.onload=()=>resolve(img); img.onerror=()=>reject(new Error('Could not read this image.')); img.src=local;
    });
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=160;
    const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Image editing is unavailable.');
    const side=Math.min(image.naturalWidth,image.naturalHeight);
    ctx.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,160,160);
    return canvas.toDataURL('image/jpeg',.81);
  } finally { URL.revokeObjectURL(local); }
}
$('#headerProfileBtn').addEventListener('click',()=>toggleProfileMenu($('#headerProfileBtn')));
$('#sidebarProfileBtn').addEventListener('click',()=>toggleProfileMenu($('#sidebarProfileBtn')));
profileMenu.addEventListener('click', async e=>{
  const action=e.target.closest('[data-profile-action]')?.dataset.profileAction;
  if(!action) return;
  if(action==='edit') openProfileDialog();
  if(action==='settings') { closeProfileMenu(); navigate('settings'); }
  if(action==='logout') await signOut();
});
$('#profileDialogClose').addEventListener('click',closeProfileDialog);
$('#profileCancel').addEventListener('click',closeProfileDialog);
profileModal.addEventListener('click',e=>{if(e.target===profileModal) closeProfileDialog();});
$('#profileRemovePhoto').addEventListener('click',()=>{editedAvatar='';renderAvatar($('#profileEditAvatar'),'',profileInitials());$('#profilePhotoFile').value='';});
$('#profilePhotoFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file) return;
  $('#profileFormError').textContent='';
  try { editedAvatar=await readAndResizeProfilePicture(file);renderAvatar($('#profileEditAvatar'),editedAvatar,profileInitials()); }
  catch(error) { $('#profileFormError').textContent=error.message; }
});
$('#profileForm').addEventListener('submit',async e=>{
  e.preventDefault(); const button=$('#profileSave');
  const name=$('#profileDisplayName').value.trim();
  if(name.length<2||name.length>48) { $('#profileFormError').textContent='Display name must be 2–48 characters.';return; }
  button.disabled=true;button.textContent='Saving…';$('#profileFormError').textContent='';
  try { const result=await api('/api/profile',{method:'POST',body:JSON.stringify({name,avatar:editedAvatar})});
    state.profile=result.profile;updateProfileUI();closeProfileDialog();notify('Profile updated successfully'); }
  catch(error) {$('#profileFormError').textContent=error.message;}
  finally {button.disabled=false;button.textContent='Save changes';}
});
document.addEventListener('click',e=>{
  if(!profileMenu.classList.contains('hidden')&&!e.target.closest('#profileMenu')&&!e.target.closest('.profile-trigger'))closeProfileMenu();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') { if(!profileModal.classList.contains('hidden'))closeProfileDialog();else closeProfileMenu(true); }
});
window.addEventListener('resize',()=>closeProfileMenu());
document.addEventListener('click', async e=>{
  const connectPicker=e.target.closest('[data-connect-picker]');
  if(connectPicker){
    e.preventDefault();
    if(currentPage!=='connections'){ navigate('connections'); return; }
    const target=$('.connect-grid');
    target?.scrollIntoView({behavior:'smooth',block:'center'});
    target?.querySelector('a[href^="/auth/"],button[data-page="settings"]')?.focus({preventScroll:true});
    return;
  }
  const pageBtn=e.target.closest('[data-page]'); if(pageBtn){ e.preventDefault(); if(pageBtn.dataset.filterPlatform) contentFilter=pageBtn.dataset.filterPlatform; navigate(pageBtn.dataset.page); return; }
  const ref=e.target.closest('[data-refresh-platform]');if(ref){await refresh(ref.dataset.refreshPlatform);return;}
  const disc=e.target.closest('[data-disconnect]');if(disc){await disconnect(disc.dataset.disconnect);return;}
  const card=e.target.closest('[data-content-id]');if(card){showContentModal(card.dataset.contentPlatform,card.dataset.contentId);return;}
  const filter=e.target.closest('[data-content-filter]');if(filter){contentFilter=filter.dataset.contentFilter;render();return;}
  if(e.target.closest('[data-select-facebook-page]')){await selectFacebookPage();return;}
});
document.addEventListener('keydown',e=>{const card=e.target.closest('[data-content-id]');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();showContentModal(card.dataset.contentPlatform,card.dataset.contentId);}});
document.addEventListener('input',e=>{if(e.target.id==='contentSearch'){contentSearch=e.target.value;const pos=e.target.selectionStart;render();const n=$('#contentSearch');if(n){n.focus();n.setSelectionRange(pos,pos);}}});
$('#refreshBtn').addEventListener('click',()=>refresh());
$('#menuToggle').addEventListener('click',()=>{$('#sidebar').classList.toggle('open');$('#scrim').classList.toggle('show');});
$('#scrim').addEventListener('click',()=>{$('#sidebar').classList.remove('open');$('#scrim').classList.remove('show');});
$('#modalClose').addEventListener('click',()=>{$('#contentModal').classList.add('hidden');$('#contentModal').setAttribute('aria-hidden','true');$('#modalBody').innerHTML='';});
$('#contentModal').addEventListener('click',e=>{if(e.target.id==='contentModal')$('#modalClose').click();});

(async()=>{
  try {
    await loadState();
    const params=new URLSearchParams(location.search);
    if(params.has('oauth_error'))showNotice(params.get('oauth_error'),'error');
    else if(params.has('connected'))showNotice(`${PLATFORM[params.get('connected')]?.name||'Account'} connected. SocialHub has attempted its first data sync.`,'success');
    if(params.has('oauth_error')||params.has('connected'))history.replaceState({},'',location.pathname);
    // Keep the dashboard current without hammering provider APIs. API responses are never cached by the service worker.
    setInterval(()=>{if(document.visibilityState==='visible'&&Object.keys(state?.accounts||{}).length)refresh();},30*60*1000);
  } catch(e) { $('#pageContent').innerHTML=emptyBlock('Could not load SocialHub',e.message,'Reload', 'overview'); }
})();;
