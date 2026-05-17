# 📡 LAN Chat — Demo Jaringan & MITM

Aplikasi pesan berbasis web untuk demonstrasi edukasi keamanan jaringan,
analisis paket Wireshark, dan serangan MITM (Man-in-the-Middle) di lingkungan lab lokal.

> ⚠️ **PERINGATAN**: Aplikasi ini SENGAJA tidak menggunakan enkripsi. Hanya untuk
> keperluan edukasi di lingkungan lab terkontrol. Jangan gunakan di jaringan produksi.

---

## 📁 Struktur Folder

```
lan-chat/
├── server.js           ← Backend: Express + Socket.IO
├── package.json        ← Dependensi Node.js
├── .gitignore
├── uploads/            ← File yang diupload user (otomatis dibuat)
│   └── .gitkeep
└── public/             ← Frontend statis
    ├── index.html      ← Halaman utama
    ├── css/
    │   └── style.css   ← Stylesheet (tema gelap, mirip WhatsApp)
    └── js/
        └── app.js      ← Logic frontend + Socket.IO client
```

---

## 🚀 Cara Menjalankan

### Prasyarat
- Node.js v16 atau lebih baru → https://nodejs.org
- Semua device di jaringan LAN yang sama (Wi-Fi router / switch yang sama)

### Langkah

```bash
# 1. Masuk ke folder project
cd lan-chat

# 2. Install dependensi (hanya sekali)
npm install

# 3. Jalankan server
node server.js
```

Output yang muncul:
```
╔══════════════════════════════════════════════╗
║          LAN CHAT SERVER STARTED             ║
╠══════════════════════════════════════════════╣
║  Local   : http://localhost:8080             ║
║  LAN     : http://192.168.1.10:8080          ║
╠══════════════════════════════════════════════╣
║  ⚠  HTTP PLAINTEXT - untuk demo Wireshark    ║
╚══════════════════════════════════════════════╝
```

---

## 🌐 Cara Akses dari Device Lain di LAN

### Langkah 1 — Cari IP laptop host

**Windows:**
```cmd
ipconfig
```
Cari bagian `Wireless LAN adapter Wi-Fi` atau `Ethernet adapter`:
```
IPv4 Address. . . . . . : 192.168.1.10
```

**macOS/Linux:**
```bash
ifconfig | grep "inet "
# atau
ip addr show | grep "inet "
```

**Linux (singkat):**
```bash
hostname -I
```

### Langkah 2 — Akses dari HP atau device lain

Buka browser di HP/laptop lain, ketik:
```
http://<IP-LAPTOP-HOST>:8080
```

Contoh:
```
http://192.168.1.10:8080
```

> 💡 Pastikan firewall laptop host mengizinkan port 8080.
> Di Windows: Windows Defender Firewall → Allow an app → Node.js

---

## 🔥 Cara Demo Wireshark (MITM / Packet Sniffing)

### Setup Wireshark

1. Install Wireshark: https://www.wireshark.org
2. Buka Wireshark, pilih interface jaringan yang aktif (Wi-Fi / Ethernet)
3. Mulai capture

### Filter yang Berguna

```
# Tampilkan semua traffic HTTP
http

# Filter port 8080 saja
tcp.port == 8080

# Lihat hanya POST request (pengiriman pesan)
http.request.method == "POST"

# Filter berdasarkan IP tertentu
ip.addr == 192.168.1.15

# Kombinasi: HTTP dari IP tertentu
http && ip.addr == 192.168.1.15
```

### Apa yang Terlihat di Wireshark

Karena aplikasi menggunakan **HTTP plaintext** dan **Socket.IO tanpa enkripsi**:

| Data | Terlihat? |
|------|-----------|
| Isi pesan teks | ✅ Ya, plaintext |
| IP pengirim & penerima | ✅ Ya |
| Timestamp | ✅ Ya |
| Nama file yang diupload | ✅ Ya |
| Konten file (gambar, dll) | ✅ Ya |
| Socket.IO handshake | ✅ Ya |
| Header HTTP | ✅ Ya |

### Contoh Paket yang Terlihat

Ketika user mengirim pesan, Socket.IO mengirim WebSocket frame berisi:
```json
42["send_message",{"from":"192.168.1.5","to":"192.168.1.10","text":"Halo!","file":null}]
```
— semuanya **plaintext**, tidak ada enkripsi, tidak ada encoding.

---

## 🛠 Port

| Port | Keterangan |
|------|------------|
| **8080** | Port default server (jarang dipakai sistem) |

Untuk mengganti port, edit baris ini di `server.js`:
```js
const PORT = 8080; // ganti sesuai kebutuhan
```

---

## 📱 Fitur Aplikasi

| Fitur | Keterangan |
|-------|------------|
| Deteksi IP otomatis | IP lokal device terdeteksi via WebRTC |
| Chat realtime | Menggunakan Socket.IO WebSocket |
| Bubble chat | Kiri (masuk) / Kanan (keluar) |
| Indikator mengetik | Muncul saat peer sedang mengetik |
| Status online | Hijau = online, abu = offline |
| Upload gambar | Preview langsung di bubble |
| Upload file | Tampil nama + tombol unduh |
| History pesan | Tersimpan di memory server (hilang saat restart) |
| Multi-device | Banyak device bisa chat bersamaan |

---

## ⚙️ Dependensi

| Package | Versi | Fungsi |
|---------|-------|--------|
| express | ^4.18 | HTTP server & routing |
| socket.io | ^4.7 | Realtime WebSocket |
| multer | ^1.4.5 | File upload handler |

---

## 🎓 Tujuan Edukasi

Aplikasi ini mendemonstrasikan:

1. **Mengapa HTTPS penting** — tanpa enkripsi, semua data terbaca
2. **Cara kerja MITM** — attacker di jaringan yang sama bisa capture semua pesan
3. **Analisis paket dengan Wireshark** — lihat struktur HTTP & WebSocket frame
4. **Kerentanan jaringan LAN** — perangkat di LAN yang sama bisa intercept traffic
5. **Socket.IO plaintext** — frame WebSocket terlihat jelas di packet capture

---

## ❓ Troubleshooting

**Port 8080 sudah dipakai:**
```bash
# Cek proses yang pakai port 8080
# Linux/Mac:
lsof -i :8080
# Windows:
netstat -ano | findstr :8080

# Ganti port di server.js
```

**HP tidak bisa akses server:**
- Pastikan HP dan laptop di Wi-Fi yang sama
- Matikan firewall sementara untuk test
- Coba ping dari HP ke laptop: `ping 192.168.1.10`

**IP terdeteksi "unknown-XXXX":**
- Browser tidak mendukung WebRTC (jarang terjadi)
- Masukkan IP manual dengan mengedit `state.myIP` di console browser:
  `state.myIP = "192.168.1.5"; socket.emit("register", state.myIP);`
# lan
