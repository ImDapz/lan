// ============================================================
//  LAN CHAT SERVER — HTTP Polling Edition
//  Untuk demonstrasi edukasi jaringan & MITM di lab lokal
//  PERINGATAN: SENGAJA tidak menggunakan enkripsi, kompresi,
//  atau encoding agar paket terbaca plaintext di Wireshark.
//  Socket.IO / WebSocket DIHAPUS — hanya HTTP polling biasa.
// ============================================================

const express = require("express");
const http    = require("http");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const os      = require("os");

const app    = express();
const server = http.createServer(app);
const PORT   = 8080;

// ── Pastikan folder uploads ada ─────────────────────────────
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ── In-memory storage ────────────────────────────────────────
// messages : { [chatId]: [ {id, from, to, text, file, timestamp} ] }
// onlineUsers: { ip: lastSeenMs }
const messages    = {};
const onlineUsers = {};

// User dianggap online jika heartbeat dalam 15 detik terakhir
const ONLINE_TTL_MS = 15_000;

// ── Multer config ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Helpers ───────────────────────────────────────────────────
function makeChatId(ip1, ip2) {
  return [ip1, ip2].sort().join("__");
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === "IPv4" && !net.internal) return net.address;
  return "127.0.0.1";
}

function liveUsers() {
  const now = Date.now();
  return Object.entries(onlineUsers)
    .filter(([, ts]) => now - ts < ONLINE_TTL_MS)
    .map(([ip]) => ip);
}

// ── Middleware ────────────────────────────────────────────────
// PENTING: gunakan express.json() dan express.urlencoded() TANPA
// opsi inflate:false / compress:false — secara default Express
// tidak mengkompresi response body (butuh middleware compression).
// Pastikan TIDAK ada middleware kompresi agar Wireshark bisa baca.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOADS_DIR));

// ── GET /api/server-info ──────────────────────────────────────
app.get("/api/server-info", (req, res) => {
  res.json({ serverIP: getLocalIP(), port: PORT });
});

// ── GET /api/my-ip ────────────────────────────────────────────
app.get("/api/my-ip", (req, res) => {
  const raw = req.headers["x-forwarded-for"] ||
              req.headers["x-real-ip"]        ||
              req.socket.remoteAddress        || "";
  const ip  = raw.split(",")[0].trim().replace(/^::ffff:/, "");
  res.json({ ip });
});

// ── GET /api/interfaces ───────────────────────────────────────
app.get("/api/interfaces", (req, res) => {
  const nets = os.networkInterfaces();
  const list = [];
  for (const [name, addrs] of Object.entries(nets))
    for (const addr of addrs)
      if (addr.family === "IPv4" && !addr.internal)
        list.push({ name, ip: addr.address });
  res.json(list);
});

// ── POST /api/heartbeat ───────────────────────────────────────
// Client kirim setiap ~5 detik agar dianggap online.
// Body plaintext: { ip: "192.168.x.x" }
app.post("/api/heartbeat", (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: "ip wajib" });
  onlineUsers[ip] = Date.now();
  res.json({ ok: true, onlineUsers: liveUsers() });
});

// ── GET /api/online-users ─────────────────────────────────────
app.get("/api/online-users", (req, res) => {
  res.json(liveUsers());
});

// ── GET /inbox ────────────────────────────────────────────────
// Ambil SEMUA pesan yang ditujukan ke ip tertentu (sebagai penerima),
// lintas semua chat. Dipakai client untuk deteksi pesan masuk baru
// dari pengirim yang belum pernah dibuka chat-nya.
// Query: to=<myIP>&since=<iso-opsional>
app.get("/inbox", (req, res) => {
  const { to, since } = req.query;
  if (!to) return res.status(400).json({ error: "to wajib" });

  const sinceMs = since ? new Date(since).getTime() : 0;
  const result  = [];

  for (const msgs of Object.values(messages)) {
    for (const m of msgs) {
      if (m.to === to && new Date(m.timestamp).getTime() > sinceMs) {
        result.push(m);
      }
    }
  }

  result.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.json(result);
});

// ── GET /messages ─────────────────────────────────────────────
// Query params: from=<ip>&to=<ip>&since=<iso-timestamp-opsional>
// Digunakan client untuk polling pesan baru.
// Response: JSON array pesan, plaintext, tidak dikompresi.
app.get("/messages", (req, res) => {
  const { from, to, since } = req.query;
  if (!from || !to) return res.status(400).json({ error: "from & to wajib" });

  const chatId = makeChatId(from, to);
  let msgs = messages[chatId] || [];

  if (since) {
    const sinceMs = new Date(since).getTime();
    msgs = msgs.filter(m => new Date(m.timestamp).getTime() > sinceMs);
  }

  // Set header eksplisit agar tidak ada chance kompresi/encoding
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.json(msgs);
});

// ── POST /send-message ────────────────────────────────────────
// Body (JSON plaintext): { from, to, text, file? }
// Pesan disimpan di memori dan bisa diambil via GET /messages.
// Semua field terlihat jelas di Wireshark.
app.post("/send-message", (req, res) => {
  const { from, to, text, file } = req.body;
  if (!from || !to) return res.status(400).json({ error: "from & to wajib" });
  if (!text && !file) return res.status(400).json({ error: "text atau file wajib" });

  const chatId = makeChatId(from, to);
  if (!messages[chatId]) messages[chatId] = [];

  const msg = {
    id:        Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    chatId,
    from,
    to,
    text:      text  || "",
    file:      file  || null,   // { filename, originalname, mimetype, size, url }
    timestamp: new Date().toISOString(),
  };

  messages[chatId].push(msg);
  // Batasi 500 pesan per chat
  if (messages[chatId].length > 500) messages[chatId].shift();

  console.log(`[MSG] ${from} -> ${to} | "${msg.text}" | file=${msg.file ? msg.file.originalname : "null"}`);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.json({ ok: true, message: msg });
});

// ── POST /api/upload ──────────────────────────────────────────
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Tidak ada file" });
  res.json({
    filename:     req.file.filename,
    originalname: req.file.originalname,
    mimetype:     req.file.mimetype,
    size:         req.file.size,
    url:          "/uploads/" + req.file.filename,
  });
});

// ── Start server ──────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  const nets   = os.networkInterfaces();
  const allIPs = [];
  for (const [name, addrs] of Object.entries(nets))
    for (const addr of addrs)
      if (addr.family === "IPv4" && !addr.internal)
        allIPs.push({ name, ip: addr.address });

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║       LAN CHAT SERVER — HTTP POLLING         ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Local   : http://localhost:${PORT}             ║`);
  for (const { name, ip } of allIPs) {
    const line = `  Network  : http://${ip}:${PORT}`;
    console.log(`║${line.padEnd(45)}║`);
  }
  console.log("╠══════════════════════════════════════════════╣");
  console.log("║  ⚠  HTTP PLAINTEXT — no WebSocket/Socket.IO  ║");
  console.log("║  Endpoint pesan : GET  /messages             ║");
  console.log("║                   POST /send-message         ║");
  console.log("╚══════════════════════════════════════════════╝");
});
