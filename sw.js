const CACHE = 'ray-shell-v2';
const SHELL = ['./icon-192.png', './icon-512.png'];

// Nama file manifest -> halaman HTML yang memakainya, untuk fitur di bawah.
const MANIFEST_PAGE = {
  'manifest.json': 'index.html',
  'manifest-admin.json': 'admin.html',
  'manifest-super-admin.json': 'super-admin.html'
};

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// iOS "Tambahkan ke Layar Utama" membaca start_url dari manifest.json lewat
// permintaan jaringan biasa ke file manifest (bukan lewat JS di halaman), jadi
// trik mengganti <link rel="manifest"> dengan Blob URL di halaman tidak selalu
// kebaca oleh iOS. Di sini Service Worker (yang ikut mencegat permintaan ke
// manifest.json) menyisipkan ?klien=... dari halaman yang memintanya ke dalam
// start_url, supaya tetap kebawa walau Blob trick gagal.
async function manifestDenganQueryString(request, namaFile, halaman) {
  let qs = '';
  try {
    // Permintaan manifest.json selalu disertai Referer = URL halaman yang memintanya,
    // di sinilah ?klien=... yang sedang dibuka ikut terbawa.
    const ref = request.referrer;
    if (ref) qs = new URL(ref).search;
  } catch (e) {}
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
