// config.js — pengaturan API. Hanya file ini yang perlu diubah kalau endpoint berubah.
// Kyzz API · kategori Music (Spotify) — dokumentasi: https://api.kyzzz.xyz/docs/music
(function () {
  const pick = (o, keys) => {
    if (!o || typeof o !== 'object') return '';
    for (const k of keys) {
      const v = o[k];
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v) && !v.length) continue;
      return v;
    }
    return '';
  };
  const text = (v) => {
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
    if (typeof v === 'object') return text(pick(v, ['name', 'title', 'artist', 'text']));
    return String(v).trim();
  };
  const link = (v) => {
    if (!v) return '';
    if (Array.isArray(v)) return link(v[0]);
    if (typeof v === 'object') return link(pick(v, ['url', 'src', 'link', 'large', 'medium', 'small']));
    return String(v).trim();
  };
  // Dari array gambar [{url,width,height}] ambil yang paling dekat 300px (pas untuk thumbnail)
  const image = (v) => {
    if (Array.isArray(v)) {
      const sized = v.filter((x) => x && typeof x === 'object' && x.url && x.width);
      if (sized.length) {
        sized.sort((a, b) => Math.abs(a.width - 300) - Math.abs(b.width - 300));
        return String(sized[0].url).trim();
      }
    }
    return link(v);
  };
  const seconds = (v) => {
    if (v && typeof v === 'object') return seconds(pick(v, ['seconds', 'timestamp', 'text']));
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'string' && v.indexOf(':') > -1) {
      return v.split(':').reduce((a, p) => a * 60 + (parseInt(p, 10) || 0), 0);
    }
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.round(n > 10000 ? n / 1000 : n);
  };

  const LIST_KEYS = ['result', 'results', 'data', 'items', 'tracks', 'top_tracks', 'songs', 'list'];
  const TITLE_KEYS = ['title', 'name', 'judul', 'song', 'trackName'];
  const ARTIST_KEYS = ['artist', 'artists', 'author', 'singer', 'channel', 'uploader'];
  const COVER_KEYS = ['cover', 'thumbnail', 'thumb', 'image', 'images', 'img', 'artwork', 'poster', 'thumbnails'];
  const LENGTH_KEYS = ['duration', 'duration_ms', 'durasi', 'length', 'timestamp'];
  const AUDIO_KEYS = ['dl', 'audio', 'audioUrl', 'audio_url', 'download', 'download_url', 'downloadUrl', 'mp3', 'stream', 'streamUrl'];
  const PREVIEW_KEYS = ['preview', 'preview_url', 'previewUrl'];
  const looksAudio = (u) => /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)(\?|#|$)/i.test(u || '');

  const findList = (j, depth) => {
    if (Array.isArray(j)) return j;
    if (!j || typeof j !== 'object' || (depth || 0) > 3) return [];
    for (const k of LIST_KEYS) {
      if (j[k] !== undefined) {
        const r = findList(j[k], (depth || 0) + 1);
        if (r.length) return r;
      }
    }
    return [];
  };
  const flat = (o) => Object.assign({}, o, o && typeof o.metadata === 'object' ? o.metadata : {});

  // Objek tunggal dianggap "lagu" kalau punya durasi / artis / link audio, dan bukan koleksi (album, playlist, artis)
  const looksTrack = (o) => !Array.isArray(o.tracks) && !Array.isArray(o.top_tracks) &&
    (pick(o, LENGTH_KEYS) !== '' || pick(o, ARTIST_KEYS) !== '' || pick(o, AUDIO_KEYS) !== '');
  const single = (j) => {
    for (const src of [j && j.result, j && j.data, j]) {
      if (src && typeof src === 'object' && !Array.isArray(src)) {
        const o = flat(src);
        if (pick(o, TITLE_KEYS) && looksTrack(o)) return src;
      }
    }
    return null;
  };

  // Mengubah 1 item respons API -> bentuk standar yang dipakai app.js
  const mapTrack = (raw) => {
    const o = flat(raw);
    const title = text(pick(o, TITLE_KEYS));
    const artist = text(pick(o, ARTIST_KEYS));
    const page = link(pick(o, ['url', 'link', 'permalink']));
    let audio = link(pick(o, AUDIO_KEYS));
    if (!audio && looksAudio(page)) audio = page;
    // Link preview (biasanya cuma 30 detik) hanya dipakai kalau tidak ada endpoint resolve
    if (!audio && !cfg.resolve.path) audio = link(pick(o, PREVIEW_KEYS));
    const cover = image(pick(o, COVER_KEYS)) ||
      (o.album && typeof o.album === 'object' ? image(pick(o.album, COVER_KEYS)) : '');
    return {
      id: String(pick(o, ['id', 'videoId', 'track_id']) || page || title + '|' + artist),
      title: title,
      artist: artist,
      cover: cover,
      duration: seconds(pick(o, LENGTH_KEYS)),
      url: page,
      audio: audio
    };
  };

  const cfg = {
    siteName: 'MEG MUSIC',

    // Alamat proxy. Biarkan begini kalau web & proxy ada di project Vercel yang sama.
    // (Kalau nanti dibungkus APK dari file lokal, isi URL penuh: 'https://NAMA-APP.vercel.app/api/proxy')
    proxy: '/api/proxy',

    // Cari lagu — GET /api/music/spotify/search?query=...
    search: {
      path: '/api/music/spotify/search',
      param: 'query',
      extra: {}                         // parameter tetap lain, mis. { limit: 20 }
    },

    // Link audio — GET /api/music/spotify/download?url=<link lagu Spotify>  → result.dl
    resolve: {
      path: '/api/music/spotify/download',
      param: 'url',                     // isinya link lagu dari hasil pencarian
      extra: {},
      always: false                     // true = selalu ambil ulang link audio (kalau cepat kedaluwarsa)
    },

    // Link Spotify yang ditempel di kotak cari -> daftar lagu (parameter id berisi link-nya)
    link: {
      track: { path: '/api/music/spotify/track', param: 'id' },
      album: { path: '/api/music/spotify/album', param: 'id' },
      artist: { path: '/api/music/spotify/artist', param: 'id' },
      playlist: { path: '/api/music/spotify/playlist', param: 'id' }
    },

    // Deteksi link / URI Spotify -> { type, url } (url dibersihkan jadi bentuk standar) atau null
    parseLink(q) {
      const m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|artist|playlist)\/([A-Za-z0-9]{10,})/i.exec(q) ||
        /spotify:(track|album|artist|playlist):([A-Za-z0-9]{10,})/i.exec(q);
      if (!m) return null;
      const type = m[1].toLowerCase();
      return { type: type, url: 'https://open.spotify.com/' + type + '/' + m[2] };
    },

    // Respons pencarian / album / artis / track -> daftar lagu
    mapSearch(json) {
      let list = findList(json);
      if (!list.length) {
        const one = single(json);
        if (one) list = [one];
      }
      // Respons album/artis: cover & nama artis ada di level induk, bukan di tiap lagu
      const parent = json && typeof json === 'object' ? (json.result || json.data) : null;
      const info = parent && typeof parent === 'object' && !Array.isArray(parent) ? flat(parent) : null;
      const pCover = info ? image(pick(info, COVER_KEYS)) : '';
      const pArtist = info
        ? text(pick(info, ARTIST_KEYS)) || (Array.isArray(info.top_tracks) ? text(info.name) : '')
        : '';
      return list
        .filter((x) => x && typeof x === 'object' && !(x.playability && x.playability.playable === false))
        .map((x) => {
          const t = mapTrack(x);
          if (!t.cover) t.cover = pCover;
          if (!t.artist) t.artist = pArtist;
          return t;
        })
        .filter((t) => t.title);
    },

    // Respons endpoint download -> link audio (string), yaitu result.dl
    mapResolve(json) {
      const cands = [];
      const push = (v) => {
        if (Array.isArray(v)) v = v[0];
        if (v && typeof v === 'object') cands.push(v);
        else if (typeof v === 'string' && v) cands.push({ url: v });
      };
      push(json && json.result);
      push(json && json.data);
      push(json);
      for (const o of cands) {
        const u = link(pick(o, AUDIO_KEYS)) ||
          link(pick(o.downloads || o.media || {}, AUDIO_KEYS)) ||
          link(pick(o, ['url', 'link']));
        if (u) return u;
      }
      return '';
    },

    // Respons HTTP 200 tapi isinya error (mis. { status:false, message:'...' })
    isError(j) {
      if (j && typeof j === 'object' && (j.status === false || j.success === false || j.ok === false)) {
        return text(pick(j, ['message', 'msg', 'error', 'detail'])) || 'API mengembalikan error';
      }
      return '';
    },

    errorText(j, status) {
      const m = j && typeof j === 'object' ? text(pick(j, ['message', 'msg', 'error', 'detail'])) : '';
      const tail = m ? ' — ' + m : '';
      if (status === 401 || status === 403) return 'API key ditolak (cek KYZZZ_API_KEY di Vercel / matikan IP whitelist)' + tail;
      if (status === 404) return 'endpoint tidak ditemukan, cek path di config.js' + tail;
      if (status === 429) return 'limit request API tercapai, coba lagi nanti';
      return m || 'error ' + status;
    }
  };

  window.MEG_CONFIG = cfg;
})();
