const CACHE = 'ray-shell-v2';
const SHELL = ['./icon-192.png', './icon-512.png'];

// Cache terpisah untuk mengingat ?klien=... terakhir per halaman. Cookie dan
// localStorage TERBUKTI tidak selalu ikut terbawa dari tab Safari biasa ke
// web app Home Screen di iOS (lihat catatan di index.html/admin.html), tapi
// Cache Storage milik Service Worker ini konsisten dipakai bersama antara
// Safari dan web app standalone karena keduanya memakai SW yang sama. Jadi
// ini dipakai sebagai sumber kebenaran yang lebih bisa diandalkan daripada
// cookie/localStorage, bukan cuma cadangan referrer manifest.
const KLIEN_CACHE = 'ray-klien-qs-v1';

// Nama file manifest -> halaman HTML yang memakainya, untuk fitur di bawah.
const MANIFEST_PAGE = {
  'manifest.json': 'index.html',
  'manifest-admin.json': 'admin.html',
  'manifest-super-admin.json': 'super-admin.html'
};
const HALAMAN_UTAMA = ['index.html', 'admin.html', 'super-admin.html'];

function kunciQs(halaman) {
  return self.location.origin + '/__qs__/' + halaman;
}
async function simpanQsTerakhir(halaman, qs) {
  if (!qs) return;
  try {
    const c = await caches.open(KLIEN_CACHE);
    await c.put(kunciQs(halaman), new Response(qs));
  } catch (e) {}
}
async function ambilQsTerakhir(halaman) {
  try {
    const c = await caches.open(KLIEN_CACHE);
    const res = await c.match(kunciQs(halaman));
    return res ? await res.text() : '';
  } catch (e) { return ''; }
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

// Fetch ke index.html/admin.html/super-admin.html HANYA kebaca Service Worker
// kalau itu request jaringan (reload/navigasi lain), tapi load PERTAMA kali
// sebuah link dibuka tidak lewat SW sama sekali (SW belum aktif, baru
// register saat itu juga). Supaya ?klien=... tetap keingat walau user
// langsung "Tambahkan ke Layar Utama" tanpa pernah reload dulu, halaman
// juga kirim qs lewat postMessage begitu SW siap (lihat kirimQsKeServiceWorker
// di index.html/admin.html/super-admin.html).
self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'SIMPAN_QS' && data.halaman && data.qs) {
    simpanQsTerakhir(data.halaman, data.qs);
  }
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== KLIEN_CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// iOS "Tambahkan ke Layar Utama" membaca start_url dari manifest.json lewat
// permintaan jaringan biasa ke file manifest (bukan lewat JS di halaman), jadi
// trik mengganti <link rel="manifest"> dengan Blob URL di halaman tidak selalu
// kebaca oleh iOS. Di sini Service Worker (yang ikut mencegat permintaan ke
// manifest.json) menyisipkan ?klien=... ke dalam start_url, supaya tetap
// kebawa walau Blob trick gagal.
async function manifestDenganQueryString(request, namaFile, halaman) {
  let qs = '';
  try {
    // Permintaan manifest.json biasanya disertai Referer = URL halaman yang
    // memintanya, di sinilah ?klien=... yang sedang dibuka ikut terbawa. Tapi
    // ini TIDAK selalu terisi saat Safari membaca manifest dari dalam alur
    // "Tambahkan ke Layar Utama" (bukan fetch biasa dari halaman) -> karena
    // itu KLIEN_CACHE dipakai sebagai cadangan di bawah.
    const ref = request.referrer;
    if (ref) qs = new URL(ref).search;
  } catch (e) {}
  if (!qs) qs = await ambilQsTerakhir(halaman);
  const base = new URL(halaman, self.location.href).href.replace(/[^/]*$/, '');
  const startUrl = qs ? base + halaman + qs : base + halaman;
  const manifest = {
    id: startUrl,
    name: namaFile === 'manifest.json' ? 'Absensi RAY — Karyawan' : (namaFile === 'manifest-admin.json' ? 'Absensi RAY — Admin' : 'Absensi RAY — Super Admin'),
    short_name: namaFile === 'manifest.json' ? 'Absensi RAY' : (namaFile === 'manifest-admin.json' ? 'RAY Admin' : 'RAY Super Admin'),
    start_url: startUrl,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#eef1f6',
    theme_color: '#17385c',
    lang: 'id',
    icons: [
      { src: base + 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: base + 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // jangan sentuh API Supabase
  if (e.request.method !== 'GET') return;

  const namaFile = url.pathname.split('/').pop();

  if (MANIFEST_PAGE[namaFile]) {
    e.respondWith(manifestDenganQueryString(e.request, namaFile, MANIFEST_PAGE[namaFile]));
    return;
  }

  if (HALAMAN_UTAMA.includes(namaFile)) {
    if (url.search) {
      // Dibuka dengan ?klien=... (dari link admin) -> ingat untuk dipakai
      // kalau nanti dibuka lagi tanpa query string (dari ikon Home Screen).
      e.waitUntil(simpanQsTerakhir(namaFile, url.search));
    } else if (e.request.mode === 'navigate') {
      // Dibuka tanpa query string DAN ini navigasi halaman penuh (bukan cuma
      // sub-resource) -> kemungkinan besar dibuka dari ikon Home Screen yang
      // start_url-nya gagal membawa ?klien=... Redirect di level Service
      // Worker ini tidak bergantung pada cookie/localStorage halaman sama
      // sekali, jadi tetap jalan walau storage itu tidak ikut terbawa ke
      // web app standalone.
      e.respondWith((async () => {
        const savedQs = await ambilQsTerakhir(namaFile);
        if (savedQs) return Response.redirect(url.origin + url.pathname + savedQs, 302);
        return fetch(e.request).catch(() => caches.match(e.request));
      })());
      return;
    }
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
