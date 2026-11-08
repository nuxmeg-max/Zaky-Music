(() => {
  'use strict';

  const C = window.MEG_CONFIG;
  const $ = (s) => document.querySelector(s);
  const el = {
    form: $('#searchForm'), q: $('#q'), brand: $('#brand'), tabs: $('#tabs'),
    status: $('#status'), list: $('#list'), player: $('#player'),
    cover: $('#pCover'), title: $('#pTitle'), artist: $('#pArtist'),
    cur: $('#cur'), dur: $('#dur'), seek: $('#seek'), vol: $('#vol'),
    play: $('#btnPlay'), prev: $('#btnPrev'), next: $('#btnNext'),
    shuffle: $('#btnShuffle'), repeat: $('#btnRepeat'),
    toast: $('#toast'), audio: $('#audio')
  };

  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>'
  };
  const HINT = {
    results: '// ketik judul lagu atau nama artis — atau tempel link Spotify (lagu, album, artis, playlist)',
    favorites: '// belum ada favorit — tekan ♡ pada lagu',
    recent: '// belum ada riwayat putar'
  };
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  const SEARCH_TTL = 10 * 60 * 1000;
  const RESOLVE_TTL = 10 * 60 * 1000;

  const store = {
    get(k, d) {
      try {
        const v = JSON.parse(localStorage.getItem(k));
        return v === null || v === undefined ? d : v;
      } catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } }
  };
  const saved = (k) => { const v = store.get(k, []); return Array.isArray(v) ? v : []; };

  const state = {
    tab: 'results', results: [], favorites: saved('meg_fav'), recent: saved('meg_recent'),
    queue: [], index: -1,
    shuffle: !!store.get('meg_shuffle', false), repeat: store.get('meg_repeat', 'off'),
    errors: 0, dragging: false, loaded: false
  };
  const searchCache = new Map();
  const resolveCache = new Map();
  let resultInfo = { msg: '', err: false };
  let searchSeq = 0, loadSeq = 0, toastTimer = 0, unlocked = false, failedSrc = '', retryId = '';

  /* ---------- util ---------- */
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const fmt = (s) => {
    s = Math.floor(Number(s));
    if (!isFinite(s) || s < 0) return '0:00';
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const current = () => state[state.tab] || [];
  const isReal = () => !!el.audio.currentSrc && el.audio.currentSrc.indexOf('data:') !== 0;

  // Durasi lagu: dari elemen audio, atau dari data lagu kalau stream tidak memberi durasi
  function total() {
    const d = el.audio.duration;
    if (isFinite(d) && d > 0) return d;
    const t = state.queue[state.index];
    return (t && t.duration) || 0;
  }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
  }
  function setStatus(msg, err) {
    el.status.textContent = msg || '';
    el.status.classList.toggle('err', !!err);
  }
  function refreshStatus() {
    if (state.tab === 'results') setStatus(resultInfo.msg || HINT.results, resultInfo.err);
    else setStatus(current().length ? '// ' + current().length + ' lagu' : HINT[state.tab]);
  }
  function setResult(msg, err) {
    resultInfo = { msg: msg, err: !!err };
    refreshStatus();
  }

  /* ---------- API (lewat proxy) ---------- */
  async function api(path, params) {
    const qs = new URLSearchParams(Object.assign({ path: path }, params));
    let res;
    try { res = await fetch(C.proxy + '?' + qs.toString()); }
    catch (e) { throw new Error('tidak bisa terhubung ke server'); }
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (e) { /* bukan JSON */ }
    if (!res.ok) throw new Error(C.errorText(json, res.status));
    if (json === null) throw new Error('respons API bukan JSON');
    const bad = C.isError(json);
    if (bad) throw new Error(bad);
    return json;
  }

  // Kotak cari: teks biasa = cari lagu, link Spotify = buka lagu / album / artis / playlist-nya
  async function search(raw) {
    const q = String(raw || '').trim();
    if (!q) return;
    showTab('results');
    const ref = C.parseLink(q);
    if (!ref && /^https?:\/\//i.test(q)) {
      return setResult('// link tidak dikenali — pakai link open.spotify.com (lagu, album, artis, playlist)', true);
    }
    const ep = ref ? C.link[ref.type] : C.search;
    const key = (ref ? ref.url : q).toLowerCase();
    const what = ref ? 'link ' + ref.type : '“' + q + '”';
    const msg = (n) => n
      ? '// ' + n + (ref ? ' lagu dari ' : ' hasil untuk ') + what
      : '// ' + (ref ? what + ' tidak mengembalikan daftar lagu' : 'tidak ada hasil untuk ' + what);

    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.t < SEARCH_TTL) {
      state.results = hit.tracks;
      render();
      return setResult(msg(hit.tracks.length));
    }
    const id = ++searchSeq;
    el.list.innerHTML = '<li class="skel"></li>'.repeat(6);
    setResult('// memuat ' + what + ' …');
    try {
      const params = Object.assign({}, ep.extra);
      params[ep.param] = ref ? ref.url : q;
      const tracks = C.mapSearch(await api(ep.path, params));
      if (id !== searchSeq) return;
      if (tracks.length) searchCache.set(key, { t: Date.now(), tracks: tracks });
      state.results = tracks;
      render();
      setResult(msg(tracks.length));
    } catch (e) {
      if (id !== searchSeq) return;
      state.results = [];
      render();
      setResult('// gagal: ' + e.message, true);
    }
  }

  async function audioUrl(t) {
    const R = C.resolve;
    if (t.audio && !R.always) return t.audio;
    if (!R.path) return t.audio || '';
    const hit = resolveCache.get(t.id);
    if (hit && Date.now() - hit.t < RESOLVE_TTL) return hit.url;
    const params = Object.assign({}, R.extra);
    params[R.param] = t.url || t.id;
    const url = C.mapResolve(await api(R.path, params));
    if (url) resolveCache.set(t.id, { t: Date.now(), url: url });
    return url;
  }

  /* ---------- daftar, tab, favorit ---------- */
  function render() {
    const now = state.queue[state.index];
    const playingId = now ? now.id : null;
    el.list.innerHTML = current().map((t, i) => {
      const fav = state.favorites.some((f) => f.id === t.id);
      const img = t.cover ? '<img loading="lazy" alt="" src="' + esc(t.cover) + '" onerror="this.remove()">' : '';
      return '<li class="item' + (t.id === playingId ? ' playing' : '') + '">' +
        '<button type="button" class="row" data-play="' + i + '">' +
          '<span class="thumb">' + img + '</span>' +
          '<span class="meta"><span class="t">' + esc(t.title) + '</span>' +
          '<span class="a">' + esc(t.artist || '—') + (t.duration ? ' · ' + fmt(t.duration) : '') + '</span></span>' +
        '</button>' +
        '<button type="button" class="fav' + (fav ? ' on' : '') + '" data-fav="' + i + '" aria-label="Favorit">' + (fav ? '♥' : '♡') + '</button>' +
      '</li>';
    }).join('');
  }

  function showTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(el.tabs.children, (b) => b.classList.toggle('active', b.dataset.tab === tab));
    render();
    refreshStatus();
  }

  function toggleFav(t) {
    if (!t) return;
    const i = state.favorites.findIndex((f) => f.id === t.id);
    if (i >= 0) state.favorites.splice(i, 1); else state.favorites.unshift(t);
    store.set('meg_fav', state.favorites);
    render();
    refreshStatus();
  }

  function addRecent(t) {
    state.recent = [t].concat(state.recent.filter((x) => x.id !== t.id)).slice(0, 30);
    store.set('meg_recent', state.recent);
    if (state.tab === 'recent') { render(); refreshStatus(); }
  }

  /* ---------- pemutaran ---------- */
  // iOS hanya mengizinkan play() setelah elemen audio "dibuka" lewat sentuhan pengguna.
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try {
      el.audio.src = SILENT;
      const p = el.audio.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* abaikan */ }
  }

  function playList(items, i) {
    unlockAudio();
    state.queue = items.slice();
    state.index = i;
    loadCurrent();
  }

  function showPlayer(t, loading) {
    el.player.hidden = false;
    el.title.textContent = t.title;
    el.artist.textContent = loading ? '// memuat…' : (t.artist || '—');
    if (t.cover) {
      el.cover.style.display = '';
      if (el.cover.getAttribute('src') !== t.cover) el.cover.src = t.cover;
    } else {
      el.cover.removeAttribute('src');
      el.cover.style.display = 'none';
    }
    document.title = t.title + ' — ' + C.siteName;
  }

  function resetProgress(t) {
    el.seek.value = 0;
    el.seek.style.setProperty('--p', '0%');
    el.cur.textContent = '0:00';
    el.dur.textContent = t.duration ? fmt(t.duration) : '0:00';
  }

  function setMedia(t) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: t.artist || '', album: C.siteName,
        artwork: t.cover ? [{ src: t.cover, sizes: '512x512' }] : []
      });
    } catch (e) { /* abaikan */ }
  }

  function fail(msg) {
    state.errors++;
    toast('Gagal memutar: ' + msg);
    const t = state.queue[state.index];
    if (t) showPlayer(t, false);
    const id = loadSeq;
    if (state.queue.length > 1 && state.errors < 3) {
      setTimeout(() => { if (id === loadSeq) step(1, true); }, 1000);
    }
  }

  async function loadCurrent() {
    const t = state.queue[state.index];
    if (!t) return;
    const id = ++loadSeq;
    state.loaded = false;
    failedSrc = '';
    el.audio.pause();
    showPlayer(t, true);
    resetProgress(t);
    render();
    try {
      const url = await audioUrl(t);
      if (id !== loadSeq) return;
      if (!url) throw new Error('link audio tidak ditemukan');
      el.audio.src = url;
      showPlayer(t, false);
      setMedia(t);
      await el.audio.play();
      if (id === loadSeq) addRecent(t);
    } catch (e) {
      if (id !== loadSeq) return;
      const n = e && e.name;
      if (n === 'AbortError' || n === 'NotSupportedError') return; // ditangani event 'error'
      if (n === 'NotAllowedError') { toast('Tekan ▶ untuk memutar'); return; }
      fail((e && e.message) || 'error');
    }
  }

  function step(dir, auto) {
    const n = state.queue.length;
    if (!n) return;
    let i = state.index;
    if (state.shuffle && n > 1) {
      do { i = Math.floor(Math.random() * n); } while (i === state.index);
    } else {
      i += dir;
      if (i >= n || i < 0) {
        if (state.repeat === 'all' || !auto) i = (i + n) % n;
        else { el.audio.pause(); return; } // ujung antrean, berhenti
      }
    }
    state.index = i;
    loadCurrent();
  }
  const prev = () => { if (el.audio.currentTime > 3) el.audio.currentTime = 0; else step(-1, false); };
  const next = () => step(1, false);

  function setPlaying(on) {
    el.play.innerHTML = on ? ICON.pause : ICON.play;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
  }

  function onTime() {
    const d = total(), c = el.audio.currentTime;
    el.cur.textContent = fmt(c);
    el.dur.textContent = d ? fmt(d) : '0:00';
    if (!d) return;
    if (!state.dragging) {
      const v = Math.min(1000, Math.round((c / d) * 1000));
      el.seek.value = v;
      el.seek.style.setProperty('--p', v / 10 + '%');
    }
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: el.audio.playbackRate || 1 }); } catch (e) { /* abaikan */ }
    }
  }

  function syncModes() {
    el.shuffle.classList.toggle('on', state.shuffle);
    el.repeat.classList.toggle('on', state.repeat !== 'off');
    el.repeat.textContent = state.repeat === 'one' ? '↻1' : '↻';
    el.audio.loop = state.repeat === 'one';
  }

  function bindMediaKeys() {
    if (!('mediaSession' in navigator)) return;
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* abaikan */ } };
    set('play', () => el.audio.play());
    set('pause', () => el.audio.pause());
    set('previoustrack', prev);
    set('nexttrack', next);
    set('seekto', (d) => { if (d && typeof d.seekTime === 'number') el.audio.currentTime = d.seekTime; });
  }

  /* ---------- event ---------- */
  el.form.addEventListener('submit', (e) => { e.preventDefault(); el.q.blur(); search(el.q.value); });
  el.tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  el.list.addEventListener('click', (e) => {
    const p = e.target.closest('[data-play]');
    const f = e.target.closest('[data-fav]');
    if (p) playList(current(), Number(p.dataset.play));
    else if (f) toggleFav(current()[Number(f.dataset.fav)]);
  });

  el.play.addEventListener('click', () => {
    if (!state.queue.length) return;
    if (!el.audio.paused) el.audio.pause();
    else if (state.loaded) el.audio.play().catch(() => {});
    else loadCurrent();
  });
  el.prev.addEventListener('click', prev);
  el.next.addEventListener('click', next);
  el.shuffle.addEventListener('click', () => { state.shuffle = !state.shuffle; store.set('meg_shuffle', state.shuffle); syncModes(); });
  el.repeat.addEventListener('click', () => {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    store.set('meg_repeat', state.repeat);
    syncModes();
  });

  el.seek.addEventListener('input', () => {
    state.dragging = true;
    el.seek.style.setProperty('--p', el.seek.value / 10 + '%');
    const d = total();
    if (d) el.cur.textContent = fmt((el.seek.value / 1000) * d);
  });
  el.seek.addEventListener('change', () => {
    const d = total();
    if (d) el.audio.currentTime = (el.seek.value / 1000) * d;
    state.dragging = false;
  });
  el.vol.addEventListener('input', () => {
    el.audio.volume = Number(el.vol.value);
    el.vol.style.setProperty('--p', el.vol.value * 100 + '%');
    store.set('meg_vol', Number(el.vol.value));
  });

  el.audio.addEventListener('playing', () => {
    if (isReal()) { state.loaded = true; state.errors = 0; retryId = ''; setPlaying(true); }
  });
  el.audio.addEventListener('pause', () => setPlaying(false));
  el.audio.addEventListener('ended', () => { if (isReal()) step(1, true); });
  el.audio.addEventListener('error', () => {
    const s = el.audio.currentSrc;
    if (!isReal() || s === failedSrc) return;
    failedSrc = s;
    const t = state.queue[state.index];
    // Link audio dari endpoint download bertoken & bisa kedaluwarsa: ambil link baru satu kali
    if (t && C.resolve.path && !t.audio && retryId !== t.id) {
      retryId = t.id;
      resolveCache.delete(t.id);
      loadCurrent();
      return;
    }
    fail('audio tidak bisa dimuat (kode ' + (el.audio.error ? el.audio.error.code : '?') + ')');
  });
  ['timeupdate', 'loadedmetadata', 'durationchange'].forEach((n) => el.audio.addEventListener(n, onTime));
  el.cover.addEventListener('error', () => { el.cover.style.display = 'none'; });

  /* ---------- mulai ---------- */
  el.brand.textContent = C.siteName;
  document.title = C.siteName;
  el.prev.innerHTML = ICON.prev;
  el.next.innerHTML = ICON.next;
  el.play.innerHTML = ICON.play;
  const v0 = Number(store.get('meg_vol', 1));
  const vol = isFinite(v0) ? Math.min(1, Math.max(0, v0)) : 1;
  el.vol.value = vol;
  el.audio.volume = vol;
  el.vol.style.setProperty('--p', vol * 100 + '%');
  syncModes();
  bindMediaKeys();
  showTab('results');

  const first = new URLSearchParams(location.search).get('q');
  if (first) { el.q.value = first; search(first); }
})();
