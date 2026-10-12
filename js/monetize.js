// Ads and the one-time "Remove ads" upgrade.
// Purchases are Lemon Squeezy licence keys: the key is activated once against the Lemon Squeezy licence API
// (it allows calls straight from the browser), stored locally, and re-checked quietly when online.
import { CONFIG } from './config.js';
import { $, $$, el, toast } from './util.js';

const STORE_KEY = 'pianotutor.licence';
const API = 'https://api.lemonsqueezy.com/v1/licenses';
const isDesktop = location.protocol === 'app:' || /Electron/.test(navigator.userAgent);

let licence = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } })();
let personal = false; // private build with the bundled song collection: never shows ads
let adsenseLoaded = false;

export const isPro = () => !!licence;
export const adsOn = () => !personal && !licence;

export function initMonetize({ personalEdition }) {
  personal = !!personalEdition;
  $('#upgradeBtn').onclick = openUpgrade;
  $('#upgradeClose').onclick = closeUpgrade;
  $('#upgradeDialog').addEventListener('click', (e) => { if (e.target.id === 'upgradeDialog') closeUpgrade(); });
  $('#licenceForm').onsubmit = (e) => { e.preventDefault(); activate($('#licenceKey').value.trim()); };
  $('#buyBtn').onclick = buy;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#upgradeDialog').hidden) closeUpgrade(); });
  renderAds();
  revalidate();
}

/* ---------- ad spots ---------- */

export function renderAds() {
  const on = adsOn();
  document.body.classList.toggle('pro', isPro());
  $('#upgradeBtn').hidden = !on;
  $('#proBadge').hidden = !isPro();
  for (const spot of $$('.ad-slot')) {
    spot.hidden = !on;
    if (!on) { spot.replaceChildren(); continue; }
    if (spot.dataset.filled) continue;
    const slotId = CONFIG.ads.slots[spot.dataset.slot];
    if (!isDesktop && CONFIG.ads.adsenseClient && slotId) fillAdsense(spot, slotId);
    else if (spot.dataset.slot === 'library') fillHouseAd(spot);
    else { spot.hidden = true; continue; } // the sidebar already has the Remove ads button
    spot.dataset.filled = '1';
  }
}

function fillAdsense(spot, slotId) {
  if (!adsenseLoaded) {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CONFIG.ads.adsenseClient)}`;
    document.head.append(s);
    adsenseLoaded = true;
  }
  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = 'block';
  ins.dataset.adClient = CONFIG.ads.adsenseClient;
  ins.dataset.adSlot = slotId;
  ins.dataset.adFormat = 'auto';
  ins.dataset.fullWidthResponsive = 'true';
  spot.replaceChildren(el('span', 'ad-label', 'Advertisement'), ins);
  (window.adsbygoogle = window.adsbygoogle || []).push({});
}

// Our own "ad": an invitation to remove ads
function fillHouseAd(spot) {
  const box = el('div', 'house-ad');
  const text = el('div', 'house-text');
  text.append(el('b', '', 'Enjoying Piano Tutor?'), el('span', '', `Remove ads forever for ${CONFIG.upgrade.price}. One payment, no subscription.`));
  const b = el('button', 'btn sm primary', 'Remove ads');
  b.onclick = openUpgrade;
  box.append(text, b);
  spot.replaceChildren(box);
}

/* ---------- upgrade dialog ---------- */

export function openUpgrade() {
  $('#upgradePrice').textContent = CONFIG.upgrade.price;
  $('#buyBtn').disabled = !CONFIG.upgrade.checkoutUrl;
  $('#buyNote').hidden = !!CONFIG.upgrade.checkoutUrl;
  $('#licenceMsg').textContent = '';
  $('#upgradeBody').hidden = isPro();
  $('#upgradeDone').hidden = !isPro();
  $('#upgradeDialog').hidden = false;
  setTimeout(() => (isPro() ? $('#upgradeClose') : $('#buyBtn').disabled ? $('#licenceKey') : $('#buyBtn')).focus(), 0);
}
function closeUpgrade() { $('#upgradeDialog').hidden = true; }

function buy() {
  if (!CONFIG.upgrade.checkoutUrl) return;
  window.open(CONFIG.upgrade.checkoutUrl, '_blank', 'noopener');
  $('#licenceMsg').textContent = 'After paying, paste the licence key from your receipt email below.';
}

const form = (data) => Object.entries(data).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const post = (path, data) => fetch(`${API}/${path}`, {
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: form(data),
}).then((r) => r.json());

// Keys from someone else's store must not unlock the app
function fromOurProduct(meta) {
  if (!meta) return false;
  if (CONFIG.upgrade.storeId && meta.store_id !== CONFIG.upgrade.storeId) return false;
  if (CONFIG.upgrade.productId && meta.product_id !== CONFIG.upgrade.productId) return false;
  return true;
}

async function activate(key) {
  const msg = $('#licenceMsg');
  if (!key) { msg.textContent = 'Paste the licence key from your receipt email.'; return; }
  msg.textContent = 'Checking your key…';
  $('#activateBtn').disabled = true;
  try {
    const res = await post('activate', { license_key: key, instance_name: isDesktop ? 'Piano Tutor desktop' : 'Piano Tutor web' });
    if (res.activated && fromOurProduct(res.meta)) {
      licence = { key, instance: res.instance && res.instance.id, at: Date.now() };
      localStorage.setItem(STORE_KEY, JSON.stringify(licence));
      renderAds();
      openUpgrade();
      toast('Ads removed. Thank you for supporting Piano Tutor!');
    } else {
      msg.textContent = res.error || 'That key is not valid for Piano Tutor.';
    }
  } catch {
    msg.textContent = 'Could not reach the licence server. Check your internet connection and try again.';
  } finally {
    $('#activateBtn').disabled = false;
  }
}

// Re-check a stored key now and then; only a definite "invalid" answer removes it (offline keeps it)
async function revalidate() {
  if (!licence || !navigator.onLine) return;
  if (Date.now() - (licence.checked || 0) < 7 * 864e5) return;
  try {
    const res = await post('validate', { license_key: licence.key, ...(licence.instance ? { instance_id: licence.instance } : {}) });
    if (res.valid === false && res.license_key && ['expired', 'disabled'].includes(res.license_key.status)) {
      licence = null;
      localStorage.removeItem(STORE_KEY);
      renderAds();
      return;
    }
    if (res.valid) { licence.checked = Date.now(); localStorage.setItem(STORE_KEY, JSON.stringify(licence)); }
  } catch { /* offline or server busy: try again next time */ }
}
