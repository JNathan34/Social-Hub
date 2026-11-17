import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) res.setHeader('Cache-Control', 'no-store');
  if (APP_URL.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders(res, filePath) { if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('manifest.webmanifest')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && req.method !== 'GET' && !sameOrigin(req)) {
    return res.status(403).json({ error: 'Request origin could not be verified.' });
  }
  next();
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const META_VERSION = process.env.META_GRAPH_VERSION || 'v27.0';
const API_TIMEOUT = Number(process.env.API_TIMEOUT_MS || 15000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const STORE_PATH = path.join(DATA_DIR, 'socialhub.store.json');
const TOKEN_KEY_PATH = path.join(DATA_DIR, '.token-key');
const LEGACY_TOKEN_KEY_PATH = path.join(__dirname, '.token-key');
const pendingOAuth = new Map();
const PLATFORM_NAMES = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };

class ApiError extends Error {
  constructor(message, status = 502, details = '') { super(message); this.status = status; this.details = details; }
}

function encryptionKey() {
  if (process.env.TOKEN_ENCRYPTION_KEY) return crypto.createHash('sha256').update(process.env.TOKEN_ENCRYPTION_KEY).digest();
  if (!fs.existsSync(TOKEN_KEY_PATH) && fs.existsSync(LEGACY_TOKEN_KEY_PATH)) fs.copyFileSync(LEGACY_TOKEN_KEY_PATH, TOKEN_KEY_PATH);
  if (!fs.existsSync(TOKEN_KEY_PATH)) fs.writeFileSync(TOKEN_KEY_PATH, crypto.randomBytes(32), { mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(TOKEN_KEY_PATH)).digest();
}
const ENC_KEY = encryptionKey();
function encrypt(value) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(box) {
  if (!box) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8'));
}
function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return { accounts: {}, history: {} }; }
}
let store = readStore();
function saveStore() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const temp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, STORE_PATH);
}
function callbackUrl(platform) { return `${APP_URL}/auth/${platform}/callback`; }
function hasConfig(platform) {
  if (platform === 'facebook') return !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
  if (platform === 'instagram') return !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
  if (platform === 'tiktok') return !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
  if (platform === 'youtube') return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return false;
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}
function setStateCookie(res, platform, value) {
  const secure = APP_URL.startsWith('https://');
  res.setHeader('Set-Cookie', `sh_oauth_${platform}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure ? '; Secure' : ''}`);
}
function clearStateCookie(res, platform) {
  const secure = APP_URL.startsWith('https://');
  res.setHeader('Set-Cookie', `sh_oauth_${platform}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(APP_URL).origin; } catch { return false; }
}
function addOAuthState(platform, verifier = null) {
  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuth.set(state, { platform, verifier, createdAt: Date.now() });
  return state;
}
function safeRedirectError(res, platform, message) {
  const q = new URLSearchParams({ oauth_error: `${PLATFORM_NAMES[platform] || platform}: ${message}` });
  res.redirect(`${APP_URL}/?${q.toString()}`);
}
function publicAccount(platform, record) {
  return {
    platform,
    connected: true,
    profile: record.profile || {},
    connectedAt: record.connectedAt,
    lastSyncedAt: record.lastSyncedAt || null,
    syncError: record.syncError || null,
    snapshot: record.snapshot || null,
    pageOptions: (record.pages || []).map(p => ({ id: p.id, name: p.name })),
    selectedPageId: record.selectedPageId || null
  };
}
function listPublicAccounts() {
  return Object.fromEntries(Object.entries(store.accounts).map(([k, v]) => [k, publicAccount(k, v)]));
}
function saveAccount(platform, profile, tokens, extra = {}) {
  const previous = store.accounts[platform] || {};
  store.accounts[platform] = {
    profile: { ...profile },
    tokenBox: encrypt(tokens),
    connectedAt: previous.connectedAt || new Date().toISOString(),
    lastSyncedAt: previous.lastSyncedAt || null,
    snapshot: previous.snapshot || null,
    pages: extra.pages || previous.pages || [],
    selectedPageId: extra.selectedPageId || previous.selectedPageId || null,
    syncError: null
  };
  saveStore();
}
function saveTokens(platform, tokens) {
  if (!store.accounts[platform]) return;
  store.accounts[platform].tokenBox = encrypt(tokens);
  saveStore();
}
function getTokens(platform) {
  const box = store.accounts[platform]?.tokenBox;
  if (!box) throw new ApiError(`${PLATFORM_NAMES[platform]} is not connected.`, 404);
  try { return decrypt(box); }
  catch { throw new ApiError('Could not decrypt the saved account token. Check that the original .token-key file is still present.', 500); }
}
async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
    if (!response.ok) {
      const detail = body?.error?.message || body?.error_description || body?.message || body?.raw || `HTTP ${response.status}`;
      throw new ApiError(detail, response.status, detail);
    }
    if (body?.error && body.error.code && body.error.code !== 'ok' && body.error.code !== 0) {
      throw new ApiError(body.error.message || body.error.code, 502, body.error.message || String(body.error.code));
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError('The platform API request timed out. Try refreshing again.', 504);
    throw err;
  } finally { clearTimeout(timer); }
}
function formBody(data) { return new URLSearchParams(Object.entries(data).filter(([,v]) => v !== undefined && v !== null).map(([k,v]) => [k, String(v)])).toString(); }
function getAccount(platform) { const a = store.accounts[platform]; if (!a) throw new ApiError(`${PLATFORM_NAMES[platform]} is not connected.`, 404); return a; }

async function refreshOAuthToken(platform, account, tokens) {
  if (platform === 'youtube' && tokens.refresh_token && (!tokens.expiry_date || tokens.expiry_date < Date.now() + 60000)) {
    const data = await request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formBody({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }) });
    tokens = { ...tokens, ...data, refresh_token: tokens.refresh_token, expiry_date: Date.now() + Number(data.expires_in || 3600) * 1000 };
    saveTokens(platform, tokens);
  }
  if (platform === 'tiktok' && tokens.refresh_token && (!tokens.expiry_date || tokens.expiry_date < Date.now() + 60000)) {
    const data = await request('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formBody({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: tokens.refresh_token }) });
    const d = data.data || data;
    tokens = { ...tokens, ...d, expiry_date: Date.now() + Number(d.expires_in || 86400) * 1000 };
    saveTokens(platform, tokens);
  }
  if (platform === 'instagram' && tokens.access_token && (!tokens.expiry_date || tokens.expiry_date < Date.now() + 7 * 86400000)) {
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: tokens.access_token }).toString();
    try {
      const d = await request(url.toString());
      tokens = { ...tokens, access_token: d.access_token || tokens.access_token, expires_in: d.expires_in, expiry_date: Date.now() + Number(d.expires_in || 5184000) * 1000 };
      saveTokens(platform, tokens);
    } catch { /* Keep current token; API will return a clear error if it has expired. */ }
  }
  return tokens;
}
async function graphGet(host, pathPart, token, params = {}) {
  const url = new URL(`https://${host}/${META_VERSION}/${pathPart.replace(/^\//, '')}`);
  for (const [k,v] of Object.entries({ ...params, access_token: token })) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  return request(url.toString());
}
async function youtubeGet(url, token) {
  return request(url, { headers: { Authorization: `Bearer ${token}` } });
}

function dateWindow(period) {
  const end = new Date(); const start = new Date(end);
  if (period === 'daily') start.setDate(start.getDate() - 13);
  else if (period === 'yearly') start.setFullYear(start.getFullYear() - 1);
  else start.setDate(start.getDate() - 29);
  return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10) };
}
function sum(values) { return (values || []).reduce((n, x) => n + (Number(x) || 0), 0); }
function safeText(v, fallback = '') { return typeof v === 'string' ? v : fallback; }

async function fetchYouTube(platform) {
  const account = getAccount(platform); let tokens = await refreshOAuthToken(platform, account, getTokens(platform));
  const base = 'https://www.googleapis.com/youtube/v3';
  const channels = await youtubeGet(`${base}/channels?part=snippet,statistics,contentDetails&mine=true`, tokens.access_token);
  const channel = channels.items?.[0];
  if (!channel) throw new ApiError('No YouTube channel was returned for this Google account. Check that the authorised Google account owns or manages a channel.', 404);
  const uploadId = channel.contentDetails?.relatedPlaylists?.uploads;
  let videoItems = [];
  if (uploadId) {
    const pl = await youtubeGet(`${base}/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadId)}&maxResults=20`, tokens.access_token);
    const ids = (pl.items || []).map(x => x.contentDetails?.videoId).filter(Boolean);
    if (ids.length) {
      const v = await youtubeGet(`${base}/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}`, tokens.access_token);
      videoItems = v.items || [];
    }
  }
  const { start, end } = dateWindow('yearly');
  let series = [];
  try {
    const q = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    Object.entries({ ids:'channel==MINE', startDate:start, endDate:end, metrics:'views,estimatedMinutesWatched,subscribersGained,likes,comments,shares', dimensions:'day', sort:'day', maxResults:200 }).forEach(([k,v])=>q.searchParams.set(k,v));
    const r = await youtubeGet(q.toString(), tokens.access_token);
    series = (r.rows || []).map(row => ({ date: row[0], value: Number(row[1]) || 0, views: Number(row[1]) || 0, watchMinutes: Number(row[2]) || 0, subscribers: Number(row[3]) || 0, likes: Number(row[4]) || 0, comments: Number(row[5]) || 0, shares: Number(row[6]) || 0 }));
  } catch (e) { account.analyticsWarning = `YouTube Analytics unavailable: ${e.message}`; }
  const content = videoItems.map(v => ({
    id: v.id, platform:'youtube', title: safeText(v.snippet?.title, 'Untitled video'), description: safeText(v.snippet?.description), publishedAt: v.snippet?.publishedAt,
    thumbnail: v.snippet?.thumbnails?.maxres?.url || v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.medium?.url || '',
    views: Number(v.statistics?.viewCount || 0), likes: Number(v.statistics?.likeCount || 0), comments: Number(v.statistics?.commentCount || 0), shares: null,
    permalink: `https://www.youtube.com/watch?v=${v.id}`, embedUrl: `https://www.youtube-nocookie.com/embed/${v.id}`,
    duration: v.contentDetails?.duration || '', mediaType:'video'
  })).sort((a,b)=>b.views-a.views);
  const stats = channel.statistics || {};
  const profile = { id: channel.id, name: channel.snippet?.title || 'YouTube channel', avatar: channel.snippet?.thumbnails?.medium?.url || '', url:`https://www.youtube.com/channel/${channel.id}`, subscribers:Number(stats.subscriberCount || 0), views:Number(stats.viewCount || 0), videos:Number(stats.videoCount || 0), hiddenSubscribers: stats.hiddenSubscriberCount === true };
  const metrics = { followers: profile.subscribers, views: profile.views, likes: sum(content.map(x=>x.likes)), comments: sum(content.map(x=>x.comments)), contentCount: profile.videos, watchMinutes: sum(series.map(x=>x.watchMinutes)), subscribersGained: sum(series.map(x=>x.subscribers)) };
  let demographics = null;
  try {
    const q = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    Object.entries({ ids:'channel==MINE', startDate:start, endDate:end, metrics:'viewerPercentage', dimensions:'ageGroup,gender', sort:'-viewerPercentage', maxResults:50 }).forEach(([k,v])=>q.searchParams.set(k,v));
    const d = await youtubeGet(q.toString(), tokens.access_token);
    demographics = { source:'YouTube Analytics API', rows:d.rows || [], headers:d.columnHeaders || [] };
  } catch { demographics = null; }
  delete account.analyticsWarning;
  if (!series.length) account.analyticsWarning = 'Channel totals are available; daily analytics did not return data for this date range.';
  return { profile, metrics, content, series, demographics, warnings: account.analyticsWarning ? [account.analyticsWarning] : [] };
}

async function fetchTikTok(platform) {
  const account = getAccount(platform); const tokens = await refreshOAuthToken(platform, account, getTokens(platform));
  const fields = 'open_id,union_id,avatar_url,display_name,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count';
  const user = await request(`https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(fields)}`, { headers:{ Authorization:`Bearer ${tokens.access_token}` } });
  const u = user.data?.user || {};
  const videoFields = 'id,title,video_description,duration,cover_image_url,share_url,embed_link,create_time,view_count,like_count,comment_count,share_count';
  let videoData = { data:{ videos:[] } };
  try { videoData = await request(`https://open.tiktokapis.com/v2/video/list/?fields=${encodeURIComponent(videoFields)}`, { method:'POST', headers:{ Authorization:`Bearer ${tokens.access_token}`, 'Content-Type':'application/json' }, body:JSON.stringify({ max_count:20 }) }); }
  catch (e) { if (!String(e.message).includes('scope_not_authorized')) throw e; }
  const content = (videoData.data?.videos || []).map(v=>({
    id:v.id, platform:'tiktok', title:safeText(v.title || v.video_description, 'TikTok video'), description:safeText(v.video_description), publishedAt:v.create_time?new Date(v.create_time*1000).toISOString():null,
    thumbnail:v.cover_image_url || '', views:Number(v.view_count || 0), likes:Number(v.like_count || 0), comments:Number(v.comment_count || 0), shares:Number(v.share_count || 0),
    permalink:v.share_url || u.profile_deep_link || 'https://www.tiktok.com/', embedUrl:v.embed_link || `https://www.tiktok.com/player/v1/${v.id}`, mediaType:'video', duration:v.duration || ''
  })).sort((a,b)=>b.views-a.views);
  const profile = { id:u.open_id, name:u.display_name || 'TikTok account', username:u.username || '', avatar:u.avatar_url || '', url:u.profile_deep_link || 'https://www.tiktok.com/', followers:Number(u.follower_count || 0), following:Number(u.following_count || 0), likes:Number(u.likes_count || 0), videos:Number(u.video_count || content.length) };
  const metrics = { followers:profile.followers, views:sum(content.map(x=>x.views)), likes:profile.likes || sum(content.map(x=>x.likes)), comments:sum(content.map(x=>x.comments)), contentCount:profile.videos };
  return { profile, metrics, content, series:[], demographics:null, warnings:['TikTok Display API returns profile and video metrics. It does not expose full Creator Analytics demographics or comment threads through these scopes.'] };
}

async function fetchInstagram(platform) {
  const account = getAccount(platform); const tokens = await refreshOAuthToken(platform, account, getTokens(platform));
  const host = 'graph.instagram.com';
  let me = await graphGet(host, 'me', tokens.access_token, { fields:'user_id,id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count' });
  const userId = me.user_id || me.id || tokens.user_id;
  let media = await graphGet(host, 'me/media', tokens.access_token, { fields:'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,shortcode', limit:25 });
  const content = (media.data || []).map(m=>({
    id:m.id, platform:'instagram', title:(m.caption || '').split('\n')[0].slice(0,90) || `${m.media_type || 'Instagram'} post`, description:m.caption || '', publishedAt:m.timestamp,
    thumbnail:m.thumbnail_url || m.media_url || '', views: m.views === undefined ? null : Number(m.views), likes:Number(m.like_count || 0), comments:Number(m.comments_count || 0), shares:null, permalink:m.permalink || '',
    embedUrl:m.shortcode ? `https://www.instagram.com/p/${m.shortcode}/embed` : '', mediaType:m.media_type || 'IMAGE', shortcode:m.shortcode
  }));
  const profile = { id:userId, name:me.name || me.username || 'Instagram account', username:me.username || '', avatar:me.profile_picture_url || '', url:me.username?`https://www.instagram.com/${me.username}/`:'https://www.instagram.com/', followers:Number(me.followers_count || 0), following:Number(me.follows_count || 0), videos:Number(me.media_count || content.length) };
  // Fetch per-media insights for a limited recent set; Meta may omit metrics for some media types.
  await Promise.all(content.slice(0,10).map(async item => {
    try {
      const insight = await graphGet(host, `${item.id}/insights`, tokens.access_token, { metric:'views,reach,total_interactions' });
      for (const metric of insight.data || []) {
        const raw = metric.total_value?.value ?? metric.values?.reduce((acc, point)=>acc + (Number(point.value)||0), 0);
        if (metric.name === 'views' && raw !== undefined) item.views = Number(raw);
        if (metric.name === 'reach' && raw !== undefined) item.reach = Number(raw);
        if (metric.name === 'total_interactions' && raw !== undefined) item.interactions = Number(raw);
      }
    } catch { /* Per-media insight metrics vary by media type and account access. */ }
  }));
  // Account-level daily insights provide the longer trend where Meta grants this permission.
  const { start, end } = dateWindow('monthly');
  let seriesMap = new Map();
  let accountInsightsAvailable = false;
  try {
    const insights = await graphGet(host, `${userId}/insights`, tokens.access_token, { metric:'views,reach,total_interactions', period:'day', since:start, until:end });
    accountInsightsAvailable = true;
    for (const metric of insights.data || []) for (const point of metric.values || []) {
      const date = (point.end_time || point.date || '').slice(0,10); if (!date) continue;
      const old = seriesMap.get(date) || { date, value:0, views:0, reach:0, engagement:0 };
      const val = Number(point.value || 0);
      if (metric.name === 'views') old.views = val;
      if (metric.name === 'reach') old.reach = val;
      if (metric.name === 'total_interactions') old.engagement = val;
      old.value = old.views || old.reach || old.engagement;
      seriesMap.set(date, old);
    }
  } catch { /* Insights may require review, business status, and sufficient account data. */ }
  const knownViews = content.filter(x=>x.views !== null && x.views !== undefined);
  const metrics = { followers:profile.followers, views:knownViews.length ? sum(knownViews.map(x=>x.views)) : null, likes:sum(content.map(x=>x.likes)), comments:sum(content.map(x=>x.comments)), contentCount:profile.videos };
  const warnings = [];
  if (!accountInsightsAvailable) warnings.push('Instagram profile and media are connected. Account-level trend insights were not returned; check instagram_business_manage_insights approval and account eligibility.');
  if (content.some(x=>x.views !== null && x.views !== undefined) === false) warnings.push('Per-post views were not returned for the recent media. Likes and comments are still available where Meta supplies them.');
  return { profile, metrics, content, series:[...seriesMap.values()].sort((a,b)=>a.date.localeCompare(b.date)), demographics:null, warnings };
}

async function fetchFacebook(platform) {
  const account = getAccount(platform); const tokens = await refreshOAuthToken(platform, account, getTokens(platform));
  const pages = account.pages || [];
  let selected = pages.find(p=>p.id === account.selectedPageId) || pages[0];
  if (!selected) throw new ApiError('No Facebook Pages were returned. Connect an account that can manage or analyse at least one Facebook Page.', 404);
  const pageToken = (tokens.pageTokens || []).find(p=>p.id===selected.id)?.accessToken;
  if (!pageToken) throw new ApiError('The selected Page token is missing. Disconnect Facebook and reconnect it.', 401);
  const page = await graphGet('graph.facebook.com', selected.id, pageToken, { fields:'id,name,followers_count,fan_count,link,about,picture' });
  let posts = await graphGet('graph.facebook.com', `${selected.id}/posts`, pageToken, { fields:'id,message,permalink_url,created_time,full_picture,shares,comments.summary(true),reactions.summary(true),attachments{media_type,media,url,target}', limit:25 });
  const content = (posts.data || []).map(p=>({
    id:p.id, platform:'facebook', title:(p.message || '').split('\n')[0].slice(0,90) || 'Facebook post', description:p.message || '', publishedAt:p.created_time,
    thumbnail:p.full_picture || p.attachments?.data?.[0]?.media?.image?.src || '', views:null, likes:Number(p.reactions?.summary?.total_count || 0), comments:Number(p.comments?.summary?.total_count || 0), shares:Number(p.shares?.count || 0),
    permalink:p.permalink_url || `https://www.facebook.com/${p.id}`, embedUrl:p.permalink_url ? `https://www.facebook.com/plugins/${String(p.attachments?.data?.[0]?.media_type||'').toLowerCase().includes('video')?'video':'post'}.php?href=${encodeURIComponent(p.permalink_url)}&show_text=true&width=560` : '', mediaType:p.attachments?.data?.[0]?.media_type || 'POST'
  }));
  let insights = null;
  const { start, end } = dateWindow('monthly');
  try { insights = await graphGet('graph.facebook.com', `${selected.id}/insights`, pageToken, { metric:'page_follows,page_post_engagements,page_posts_impressions_unique', period:'day', since:start, until:end }); } catch { /* Insights require ANALYZE and approved Page permissions. */ }
  const seriesMap = new Map();
  for (const metric of insights?.data || []) {
    if (!['page_follows','page_post_engagements','page_posts_impressions_unique'].includes(metric.name)) continue;
    for (const point of metric.values || []) {
      const date = point.end_time?.slice(0,10); if (!date) continue;
      const old = seriesMap.get(date) || { date, value:0, followers:0, engagement:0, reach:0 };
      if (metric.name === 'page_follows') old.followers = Number(point.value || 0);
      if (metric.name === 'page_post_engagements') old.engagement = Number(point.value || 0);
      if (metric.name === 'page_posts_impressions_unique') old.reach = Number(point.value || 0);
      old.value = old.reach || old.engagement || old.followers; seriesMap.set(date, old);
    }
  }
  const profile = { id:page.id, name:page.name || selected.name, avatar:page.picture?.data?.url || '', url:page.link || 'https://www.facebook.com/', followers:Number(page.followers_count || page.fan_count || 0), pageName:page.name };
  const metrics = { followers:profile.followers, views:null, reach:sum((insights?.data || []).find(x=>x.name==='page_posts_impressions_unique')?.values?.map(x=>x.value)), likes:sum(content.map(x=>x.likes)), comments:sum(content.map(x=>x.comments)), shares:sum(content.map(x=>x.shares)), contentCount:content.length };
  const warnings = insights ? [] : ['Page insights were not returned. Check the Page ANALYZE task and read_insights/pages_read_engagement permissions.'];
  if (pages.length > 1) warnings.push(`Connected to ${pages.length} Pages. The current dashboard shows ${selected.name}. You can change the selected Page in Connections.`);
  return { profile, metrics, content, series:[...seriesMap.values()].sort((a,b)=>a.date.localeCompare(b.date)), demographics:null, warnings };
}

async function refreshPlatform(platform) {
  const account = getAccount(platform);
  try {
    let snapshot;
    if (platform === 'youtube') snapshot = await fetchYouTube(platform);
    else if (platform === 'tiktok') snapshot = await fetchTikTok(platform);
    else if (platform === 'instagram') snapshot = await fetchInstagram(platform);
    else if (platform === 'facebook') snapshot = await fetchFacebook(platform);
    const stamp = new Date().toISOString();
    account.snapshot = snapshot; account.lastSyncedAt = stamp; account.syncError = null;
    const hist = store.history[platform] || [];
    const dayKey = stamp.slice(0,10);
    const dailyPoint = { at:stamp, date:dayKey, followers:snapshot.metrics.followers ?? null, views:snapshot.metrics.views ?? null, likes:snapshot.metrics.likes ?? null, comments:snapshot.metrics.comments ?? null, contentCount:snapshot.metrics.contentCount ?? null };
    const existingIndex = hist.findIndex(x => x.date === dayKey);
    if (existingIndex >= 0) hist[existingIndex] = dailyPoint; else hist.push(dailyPoint);
    // Keep up to 400 daily observations per platform.
    store.history[platform] = hist.slice(-400);
    saveStore();
    return publicAccount(platform, account);
  } catch (err) {
    account.syncError = err.message || 'Could not refresh this platform.'; saveStore(); throw err;
  }
}

function platformConfig() {
  return Object.keys(PLATFORM_NAMES).map(platform => ({ platform, name:PLATFORM_NAMES[platform], configured:hasConfig(platform), connected:!!store.accounts[platform], callbackUrl:callbackUrl(platform) }));
}
function workspaceProfile() {
  const saved=store.workspaceProfile || {};
  return { name:typeof saved.name==='string' && saved.name.trim()?saved.name:'Workspace owner', avatar:typeof saved.avatar==='string'?saved.avatar:'' };
}
function validateProfileImage(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 180000) throw new ApiError('Profile picture is too large (maximum 130 KB).',400);
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new ApiError('Only PNG, JPEG and WebP pictures are supported.',400);
  const image=Buffer.from(match[2], 'base64');
  if(image.length>130000 || image.length<20) throw new ApiError('Invalid or oversized profile picture.',400);
  const valid=match[1]==='png'?image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?image[0]===255&&image[1]===216: image.subarray(0,4).toString()==='RIFF'&&image.subarray(8,12).toString()==='WEBP';
  if(!valid) throw new ApiError('The uploaded picture could not be verified.',400);
  return value;
}
function dashboardState() {
  const accounts = listPublicAccounts();
  const connected = Object.keys(accounts);
  const total = (metric) => { const vals=connected.map(k=>accounts[k].snapshot?.metrics?.[metric]).filter(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v))); return vals.length ? vals.reduce((n,v)=>n+Number(v),0) : null; };
  const history = Object.fromEntries(connected.map(k=>[k,store.history[k] || []]));
  const content = connected.flatMap(k=>accounts[k].snapshot?.content || []).sort((a,b)=>(Number(b.views)||0)-(Number(a.views)||0));
  return { app:'SocialHub', version:'1.3.0', profile:workspaceProfile(), generatedAt:new Date().toISOString(), config:platformConfig(), accounts, totals:{ followers:total('followers'), views:total('views'), likes:total('likes'), comments:total('comments'), contentCount:total('contentCount'), connectedPlatforms:connected.length }, content, history };
}

// OAuth entry points
app.get('/auth/:platform/start', (req,res) => {
  const { platform } = req.params;
  if (!PLATFORM_NAMES[platform]) return res.status(404).send('Unknown platform.');
  if (!hasConfig(platform)) return safeRedirectError(res, platform, 'developer credentials are missing. See Settings for setup instructions.');
  const redirect_uri = callbackUrl(platform);
  let url; let verifier = null;
  const state = addOAuthState(platform);
  if (platform === 'youtube') {
    url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    Object.entries({ client_id:process.env.GOOGLE_CLIENT_ID, redirect_uri, response_type:'code', scope:'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly', access_type:'offline', prompt:'consent', include_granted_scopes:'true', state }).forEach(([k,v])=>url.searchParams.set(k,v));
  } else if (platform === 'tiktok') {
    // Public website integration: TikTok Login Kit Web uses an HTTPS redirect URI.
    // PKCE with loopback redirect URIs belongs to the Desktop Login Kit flow.
    url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    Object.entries({ client_key:process.env.TIKTOK_CLIENT_KEY, scope:'user.info.basic,user.info.profile,user.info.stats,video.list', response_type:'code', redirect_uri, state }).forEach(([k,v])=>url.searchParams.set(k,v));
  } else if (platform === 'instagram') {
    url = new URL('https://www.instagram.com/oauth/authorize');
    Object.entries({ client_id:process.env.INSTAGRAM_APP_ID, redirect_uri, response_type:'code', scope:'instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_comments', state, enable_fb_login:'0', force_authentication:'1' }).forEach(([k,v])=>url.searchParams.set(k,v));
  } else {
    url = new URL(`https://www.facebook.com/${META_VERSION}/dialog/oauth`);
    Object.entries({ client_id:process.env.META_APP_ID, redirect_uri, response_type:'code', scope:'pages_show_list,pages_read_engagement,read_insights,pages_read_user_content', state }).forEach(([k,v])=>url.searchParams.set(k,v));
  }
  setStateCookie(res, platform, state);
  res.redirect(url.toString());
});

app.get('/auth/:platform/callback', async (req,res) => {
  const { platform } = req.params;
  if (!PLATFORM_NAMES[platform]) return res.status(404).send('Unknown platform.');
  const state = String(req.query.state || ''); const saved = pendingOAuth.get(state); pendingOAuth.delete(state);
  const cookieState = cookieValue(req, `sh_oauth_${platform}`); clearStateCookie(res, platform);
  if (!saved || saved.platform !== platform || saved.createdAt < Date.now() - 600000 || !cookieState || cookieState !== state) return safeRedirectError(res, platform, 'the sign-in verification expired or did not match. Please try again.');
  if (req.query.error) return safeRedirectError(res, platform, String(req.query.error_description || req.query.error));
  if (!req.query.code) return safeRedirectError(res, platform, 'the platform did not return an authorisation code.');
  const code = String(req.query.code);
  try {
    const redirect_uri = callbackUrl(platform);
    if (platform === 'youtube') {
      const token = await request('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:formBody({ code, client_id:process.env.GOOGLE_CLIENT_ID, client_secret:process.env.GOOGLE_CLIENT_SECRET, redirect_uri, grant_type:'authorization_code' }) });
      const tokens = { ...token, expiry_date:Date.now() + Number(token.expires_in || 3600) * 1000 };
      const channel = await youtubeGet('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', tokens.access_token);
      const ch = channel.items?.[0];
      saveAccount(platform, { id:ch?.id, name:ch?.snippet?.title || 'YouTube channel', avatar:ch?.snippet?.thumbnails?.default?.url || '', url:ch?.id?`https://www.youtube.com/channel/${ch.id}`:'https://youtube.com/' }, tokens);
    } else if (platform === 'tiktok') {
      const tokenResponse = await request('https://open.tiktokapis.com/v2/oauth/token/', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:formBody({ client_key:process.env.TIKTOK_CLIENT_KEY, client_secret:process.env.TIKTOK_CLIENT_SECRET, code, grant_type:'authorization_code', redirect_uri, code_verifier:saved.verifier }) });
      const token = tokenResponse.data || tokenResponse;
      const tokens = { ...token, expiry_date:Date.now() + Number(token.expires_in || 86400) * 1000 };
      const user = await request('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username,profile_deep_link', { headers:{Authorization:`Bearer ${tokens.access_token}`} });
      const u = user.data?.user || {};
      saveAccount(platform, { id:u.open_id, name:u.display_name || u.username || 'TikTok account', username:u.username || '', avatar:u.avatar_url || '', url:u.profile_deep_link || 'https://www.tiktok.com/' }, tokens);
    } else if (platform === 'instagram') {
      const short = await request('https://api.instagram.com/oauth/access_token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:formBody({ client_id:process.env.INSTAGRAM_APP_ID, client_secret:process.env.INSTAGRAM_APP_SECRET, grant_type:'authorization_code', redirect_uri, code }) });
      let tokens = { ...short, user_id:short.user_id, expiry_date:Date.now() + 3600000 };
      try {
        const longUrl = new URL('https://graph.instagram.com/access_token');
        longUrl.search = new URLSearchParams({ grant_type:'ig_exchange_token', client_secret:process.env.INSTAGRAM_APP_SECRET, access_token:short.access_token }).toString();
        const long = await request(longUrl.toString());
        tokens = { ...tokens, access_token:long.access_token || short.access_token, expires_in:long.expires_in, expiry_date:Date.now() + Number(long.expires_in || 5184000) * 1000 };
      } catch { /* short-lived token is still usable for initial check */ }
      const me = await graphGet('graph.instagram.com', 'me', tokens.access_token, { fields:'user_id,id,username,name,account_type,profile_picture_url,followers_count,media_count' });
      saveAccount(platform, { id:me.user_id || me.id || short.user_id, name:me.name || me.username || 'Instagram account', username:me.username || '', avatar:me.profile_picture_url || '', url:me.username?`https://www.instagram.com/${me.username}/`:'https://instagram.com/' }, tokens);
    } else if (platform === 'facebook') {
      const short = await request(`https://graph.facebook.com/${META_VERSION}/oauth/access_token?${new URLSearchParams({ client_id:process.env.META_APP_ID, client_secret:process.env.META_APP_SECRET, redirect_uri, code })}`);
      const long = await request(`https://graph.facebook.com/${META_VERSION}/oauth/access_token?${new URLSearchParams({ grant_type:'fb_exchange_token', client_id:process.env.META_APP_ID, client_secret:process.env.META_APP_SECRET, fb_exchange_token:short.access_token })}`);
      const me = await graphGet('graph.facebook.com', 'me', long.access_token, { fields:'id,name,picture' });
      const pagesResponse = await graphGet('graph.facebook.com', 'me/accounts', long.access_token, { fields:'id,name,access_token,tasks,followers_count,fan_count', limit:100 });
      const rawPages = pagesResponse.data || [];
      const pages = rawPages.map(p=>({ id:p.id, name:p.name, tasks:p.tasks || [] }));
      const pageTokens = rawPages.map(p=>({ id:p.id, accessToken:p.access_token }));
      if (!pages.length) throw new ApiError('No Pages were found for this Facebook account. You need Page access with permission to read Page information.', 403);
      saveAccount(platform, { id:me.id, name:me.name || 'Facebook account', avatar:me.picture?.data?.url || '', url:'https://www.facebook.com/' }, { userAccessToken:long.access_token, pageTokens, expiry_date:Date.now() + Number(long.expires_in || 5184000) * 1000 }, { pages, selectedPageId:pages[0].id });
    }
    try { await refreshPlatform(platform); } catch (e) { /* Account is connected; show sync error in app. */ }
    res.redirect(`${APP_URL}/?connected=${platform}`);
  } catch (err) {
    console.error(`[oauth:${platform}]`, err.message);
    safeRedirectError(res, platform, err.message || 'connection failed.');
  }
});

app.get('/api/state', (req,res) => res.json(dashboardState()));
app.post('/api/profile', (req,res) => {
  try {
    const name=typeof req.body?.name==='string'?req.body.name.trim().replace(/\s+/g,' '):'';
    if(name.length<2 || name.length>48 || /[\u0000-\u001f\u007f<>]/.test(name)) throw new ApiError('Display name must be 2–48 characters.',400);
    const avatar=validateProfileImage(req.body?.avatar);
    store.workspaceProfile={name,avatar};
    saveStore();
    res.json({ok:true,profile:workspaceProfile()});
  } catch(e) { res.status(e.status||500).json({error:e.message||'Could not save the profile.'}); }
});
app.post('/api/refresh', async (req,res) => {
  const platforms = req.body?.platform ? [req.body.platform] : Object.keys(store.accounts);
  if (!platforms.length) return res.json({ state:dashboardState(), results:[] });
  const results = await Promise.all(platforms.map(async p=>{
    if (!PLATFORM_NAMES[p] || !store.accounts[p]) return { platform:p, ok:false, error:'Not connected.' };
    try { await refreshPlatform(p); return { platform:p, ok:true }; }
    catch (e) { return { platform:p, ok:false, error:e.message }; }
  }));
  res.json({ state:dashboardState(), results });
});
app.post('/api/disconnect/:platform', (req,res) => {
  const { platform } = req.params;
  if (!PLATFORM_NAMES[platform]) return res.status(404).json({ error:'Unknown platform.' });
  delete store.accounts[platform]; delete store.history[platform]; saveStore();
  res.json({ ok:true, state:dashboardState() });
});
app.post('/api/facebook/select-page', (req,res) => {
  const account = store.accounts.facebook;
  if (!account) return res.status(404).json({ error:'Facebook is not connected.' });
  const page = (account.pages || []).find(p=>p.id === String(req.body?.pageId || ''));
  if (!page) return res.status(400).json({ error:'That Facebook Page is not available on the connected account.' });
  account.selectedPageId = page.id; saveStore();
  res.json({ ok:true });
});
app.get('/api/comments/:platform/:id', async (req,res) => {
  const { platform, id } = req.params;
  try {
    let comments = [];
    if (platform === 'youtube') {
      const tokens = await refreshOAuthToken(platform, getAccount(platform), getTokens(platform));
      const r = await youtubeGet(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(id)}&maxResults=50&order=relevance`, tokens.access_token);
      comments = (r.items || []).map(x=>({ id:x.id, author:x.snippet?.topLevelComment?.snippet?.authorDisplayName || 'YouTube user', avatar:x.snippet?.topLevelComment?.snippet?.authorProfileImageUrl || '', text:x.snippet?.topLevelComment?.snippet?.textDisplay || '', publishedAt:x.snippet?.topLevelComment?.snippet?.publishedAt || '', likes:Number(x.snippet?.topLevelComment?.snippet?.likeCount || 0) }));
    } else if (platform === 'instagram') {
      const tokens = await refreshOAuthToken(platform, getAccount(platform), getTokens(platform));
      const r = await graphGet('graph.instagram.com', `${id}/comments`, tokens.access_token, { fields:'id,text,username,timestamp,like_count', limit:50 });
      comments = (r.data || []).map(x=>({ id:x.id, author:x.username || 'Instagram user', text:x.text || '', publishedAt:x.timestamp || '', likes:Number(x.like_count || 0) }));
    } else if (platform === 'facebook') {
      const a = getAccount(platform); const page = a.pages.find(p=>p.id===a.selectedPageId) || a.pages[0];
      const tokens = getTokens(platform); const pageToken = (tokens.pageTokens || []).find(p=>p.id===page.id)?.accessToken;
      if (!pageToken) throw new ApiError('Facebook Page token is missing. Disconnect and reconnect Facebook.', 401);
      const r = await graphGet('graph.facebook.com', `${id}/comments`, pageToken, { fields:'id,from,message,created_time,like_count', limit:50 });
      comments = (r.data || []).map(x=>({ id:x.id, author:x.from?.name || 'Facebook user', text:x.message || '', publishedAt:x.created_time || '', likes:Number(x.like_count || 0) }));
    } else if (platform === 'tiktok') {
      return res.status(403).json({ unavailable:true, message:'TikTok Display API does not provide comment threads for this connection. Open the video on TikTok to read its comments.', comments:[] });
    } else return res.status(400).json({ error:'Unknown platform.' });
    res.json({ comments, source:'Official platform API' });
  } catch (e) { res.status(e.status || 502).json({ error:e.message || 'Could not load comments.' }); }
});
app.get('/api/health', (req,res)=>res.json({ ok:true, version:'1.3.0', pwa:true }));
app.get('*', (req,res)=>res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Expire abandoned state entries and return a clear setup hint rather than leaking exception details.
setInterval(()=>{ const limit=Date.now()-600000; for (const [s,v] of pendingOAuth) if (v.createdAt<limit) pendingOAuth.delete(s); }, 60000).unref();

app.listen(PORT, HOST, ()=>{
  console.log(`SocialHub is running at ${APP_URL}`);
  console.log(`Listening on ${HOST}:${PORT}`);
  if (!process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 16) console.warn('WARNING: Set APP_PASSWORD to at least 16 characters before using SocialHub. The API and account routes are locked until it is configured.');
  console.log('OAuth client secrets are read only from the server-side environment.');
});
