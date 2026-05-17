/* ============================================================
   LAN CHAT — Client Script (HTTP Polling Edition)
   Socket.IO / WebSocket DIHAPUS.
   Komunikasi hanya lewat:
     POST /send-message  — kirim pesan
     GET  /messages      — ambil pesan baru (polling)
   ============================================================ */

// ── State ─────────────────────────────────────────────────────
const state = {
  myIP:        null,
  activePeer:  null,
  chats:       {},        // { [peerIP]: { messages:[], unread:0, lastMsg:null, lastTime:null } }
  onlineIPs:   new Set(),
  pendingFile: null,
  lastSeen:      {},      // { [chatId]: isoTimestamp — pesan terakhir per chat (untuk loadHistory)
  lastInboxSeen: null,   // isoTimestamp — pesan inbox terakhir yang sudah diterima
};

// Interval timer handles
let heartbeatTimer = null;
let pollTimer      = null;

// Polling interval (ms) — pendek agar pesan terasa realtime di demo
const POLL_INTERVAL      = 2000;
const HEARTBEAT_INTERVAL = 5000;

// ── DOM shortcut ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ══════════════════════════════════════════════════════════════
//  SETUP SCREEN
// ══════════════════════════════════════════════════════════════
async function showSetupScreen() {
  let detectedIP = "";
  try {
    const r = await fetch("/api/my-ip");
    const d = await r.json();
    detectedIP = d.ip || "";
  } catch (e) { /* ignore */ }

  const overlay = document.createElement("div");
  overlay.id = "setup-overlay";
  overlay.innerHTML = `
    <div class="setup-box">
      <div class="setup-logo">📡</div>
      <h2>LAN Chat</h2>
      <p class="setup-sub">Konfirmasi IP kamu di jaringan ini</p>

      <div class="setup-field">
        <label>IP Address kamu</label>
        <input
          type="text"
          id="setup-ip-input"
          value="${detectedIP}"
          placeholder="contoh: 192.168.0.5"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="setup-hint">
          Terdeteksi otomatis dari koneksi kamu.<br>
          Ganti jika tidak sesuai — cek dengan
          <code>ip a</code> atau <code>ipconfig</code>.
        </div>
        <div class="setup-error" id="setup-error"></div>
      </div>

      <button id="setup-btn-ok" class="setup-btn">
        Masuk ke LAN Chat →
      </button>

      <div class="setup-note">
        ⚠ HTTP Plaintext — Semua data visible di Wireshark
      </div>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #setup-overlay {
      position:fixed; inset:0;
      background:#0d1117;
      display:flex; align-items:center; justify-content:center;
      z-index:99999;
      font-family:'IBM Plex Sans',sans-serif;
    }
    .setup-box {
      background:#161b22;
      border:1px solid #30363d;
      border-radius:20px;
      padding:40px 36px;
      width:380px; max-width:92vw;
      display:flex; flex-direction:column; align-items:center;
      gap:12px;
      box-shadow:0 8px 40px rgba(0,0,0,0.7);
      animation:setupIn 0.25s ease;
    }
    @keyframes setupIn {
      from{opacity:0;transform:translateY(24px) scale(0.97);}
      to  {opacity:1;transform:translateY(0) scale(1);}
    }
    .setup-logo{font-size:52px;}
    .setup-box h2{font-size:22px;font-weight:700;color:#e6edf3;margin:0;}
    .setup-sub{font-size:13px;color:#8b949e;margin:0;text-align:center;}
    .setup-field{width:100%;margin-top:8px;}
    .setup-field label{display:block;font-size:12px;color:#8b949e;margin-bottom:6px;font-weight:500;}
    #setup-ip-input{
      width:100%;
      background:#21262d;
      border:2px solid #30363d;
      border-radius:10px;
      padding:13px 16px;
      color:#e6edf3;
      font-size:18px;
      font-family:'IBM Plex Mono',monospace;
      outline:none;
      letter-spacing:1px;
      transition:border-color 0.15s;
      box-sizing:border-box;
    }
    #setup-ip-input:focus{border-color:#25d366;}
    .setup-hint{font-size:11px;color:#6e7681;margin-top:7px;line-height:1.6;}
    .setup-hint code{background:#21262d;padding:1px 5px;border-radius:4px;font-family:'IBM Plex Mono',monospace;color:#79c0ff;}
    .setup-error{font-size:12px;color:#ff6b6b;margin-top:6px;min-height:16px;}
    .setup-btn{
      width:100%;margin-top:4px;
      background:#25d366;
      border:none;border-radius:10px;
      padding:14px;
      color:#fff;font-size:15px;font-weight:600;
      font-family:'IBM Plex Sans',sans-serif;
      cursor:pointer;
      transition:background 0.15s,transform 0.1s;
    }
    .setup-btn:hover{background:#1aab52;}
    .setup-btn:active{transform:scale(0.98);}
    .setup-note{
      font-size:11px;color:#ff8080;
      background:rgba(255,77,77,0.08);
      border:1px solid rgba(255,77,77,0.2);
      border-radius:8px;
      padding:7px 14px;
      text-align:center;
      margin-top:4px;
      width:100%;box-sizing:border-box;
    }
    #setup-overlay.hiding{opacity:0;transition:opacity 0.3s;}
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  const input = $("setup-ip-input");
  setTimeout(() => { input.focus(); input.select(); }, 100);

  const doSubmit = () => {
    const ip    = input.value.trim();
    const errEl = $("setup-error");
    if (!isValidIP(ip)) {
      errEl.textContent = "Format IP tidak valid. Contoh: 192.168.0.5";
      input.focus(); return;
    }
    errEl.textContent = "";
    overlay.classList.add("hiding");
    setTimeout(() => {
      overlay.remove(); style.remove();
      startApp(ip);
    }, 280);
  };

  $("setup-btn-ok").addEventListener("click", doSubmit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSubmit(); });
}

// ── Start app ─────────────────────────────────────────────────
function startApp(ip) {
  state.myIP = ip;
  $("my-ip-badge").textContent = ip;
  console.log("[LAN CHAT] IP saya:", ip);

  // Mulai heartbeat & polling
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  pollTimer      = setInterval(pollMessages,  POLL_INTERVAL);
}

// ══════════════════════════════════════════════════════════════
//  HTTP POLLING — HEARTBEAT
//  POST /api/heartbeat  { ip }
//  Jawaban: { ok, onlineUsers: ["192.168.x.x", ...] }
// ══════════════════════════════════════════════════════════════
async function sendHeartbeat() {
  if (!state.myIP) return;
  try {
    const res  = await fetch("/api/heartbeat", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ip: state.myIP }),
    });
    const data = await res.json();
    if (data.onlineUsers) {
      state.onlineIPs = new Set(data.onlineUsers);
      updatePeerStatus();
      renderChatList();
    }
  } catch (e) {
    showToast("⚠ Koneksi bermasalah...");
  }
}

// ══════════════════════════════════════════════════════════════
//  HTTP POLLING — AMBIL PESAN BARU
//  GET /inbox?to=<myIP>&since=<iso>
//  Mengambil SEMUA pesan masuk ke myIP dari siapapun,
//  termasuk dari pengirim yang belum pernah dibuka chat-nya.
// ══════════════════════════════════════════════════════════════
async function pollMessages() {
  if (!state.myIP) return;

  const since = state.lastInboxSeen || "";
  const url   = "/inbox?to=" + encodeURIComponent(state.myIP)
              + (since ? "&since=" + encodeURIComponent(since) : "");

  try {
    const res  = await fetch(url);
    const msgs = await res.json();
    if (!Array.isArray(msgs) || msgs.length === 0) return;

    for (const msg of msgs) {
      handleIncomingMessage(msg);
    }
    state.lastInboxSeen = msgs[msgs.length - 1].timestamp;
  } catch (e) {
    console.error("[POLL] Gagal fetch inbox:", e);
  }
}

// ── Handle incoming message ───────────────────────────────────
function handleIncomingMessage(msg) {
  const peer = msg.from === state.myIP ? msg.to : msg.from;
  if (!state.chats[peer])
    state.chats[peer] = { messages: [], unread: 0, lastMsg: null, lastTime: null };

  // Deduplikasi berdasarkan id
  if (state.chats[peer].messages.find((m) => m.id === msg.id)) return;

  state.chats[peer].messages.push(msg);
  state.chats[peer].lastMsg  = msg.text || (msg.file ? "📎 " + msg.file.originalname : "");
  state.chats[peer].lastTime = msg.timestamp;

  if (msg.from !== state.myIP && peer !== state.activePeer) {
    state.chats[peer].unread = (state.chats[peer].unread || 0) + 1;
    showToast("💬 Pesan baru dari " + msg.from);
  }

  renderChatList();
  if (peer === state.activePeer) { appendBubble(msg); scrollToBottom(); }
}

// ══════════════════════════════════════════════════════════════
//  POST /send-message — kirim pesan
//  Body JSON plaintext: { from, to, text, file? }
// ══════════════════════════════════════════════════════════════
async function sendMessage() {
  const text = $("msg-input").value.trim();
  if (!text && !state.pendingFile) return;
  if (!state.activePeer || !state.myIP) return;

  const payload = {
    from: state.myIP,
    to:   state.activePeer,
    text,
    file: state.pendingFile ? {
      filename:     state.pendingFile.filename,
      originalname: state.pendingFile.originalname,
      mimetype:     state.pendingFile.mimetype,
      size:         state.pendingFile.size,
      url:          state.pendingFile.url,
    } : null,
  };

  $("msg-input").value = "";
  autoResizeTextarea();
  clearPendingFile();

  try {
    const res  = await fetch("/send-message", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok && data.message) {
      // Tampilkan pesan yang baru dikirim langsung (tanpa tunggu poll)
      const chatKey = makeChatId(state.myIP, state.activePeer);
      state.lastSeen[chatKey] = data.message.timestamp;
      handleIncomingMessage(data.message);
    }
  } catch (e) {
    showToast("✖ Gagal kirim pesan");
    console.error("[SEND] Error:", e);
  }
}

// ── Open chat ─────────────────────────────────────────────────
async function openChat(peerIPStr) {
  state.activePeer = peerIPStr;
  if (state.chats[peerIPStr]) state.chats[peerIPStr].unread = 0;

  $("welcome-screen").style.display    = "none";
  $("chat-area-inner").style.display   = "flex";
  $("peer-ip-text").textContent        = peerIPStr;
  $("peer-avatar-text").textContent    = peerIPStr.split(".").pop();
  updatePeerStatus();

  await loadHistory(peerIPStr);
  renderChatList();
  scrollToBottom();
  $("msg-input").focus();

  if (window.innerWidth <= 640) {
    $("sidebar").classList.add("hidden");
    $("chat-area").classList.remove("hidden");
  }
}

// ── Load history (GET /messages tanpa filter since) ───────────
async function loadHistory(peerIPStr) {
  if (!state.myIP) return;
  try {
    const res  = await fetch(
      "/messages?from=" + encodeURIComponent(state.myIP) +
      "&to="            + encodeURIComponent(peerIPStr)
    );
    const msgs = await res.json();

    if (!state.chats[peerIPStr])
      state.chats[peerIPStr] = { messages: [], unread: 0, lastMsg: null, lastTime: null };

    for (const msg of msgs)
      if (!state.chats[peerIPStr].messages.find((m) => m.id === msg.id))
        state.chats[peerIPStr].messages.push(msg);

    state.chats[peerIPStr].messages.sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    // Tandai lastSeen ke pesan terakhir agar poll tidak duplikat
    if (msgs.length > 0) {
      const chatKey = makeChatId(state.myIP, peerIPStr);
      state.lastSeen[chatKey] = msgs[msgs.length - 1].timestamp;
    }

    $("messages-container").innerHTML = "";
    let lastDate = null;
    for (const msg of state.chats[peerIPStr].messages) {
      const d = new Date(msg.timestamp).toLocaleDateString("id-ID", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      });
      if (d !== lastDate) { appendDateDivider(d); lastDate = d; }
      appendBubble(msg);
    }
  } catch (e) {
    console.error("Gagal load history:", e);
  }
}

// ── File upload ───────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  $("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast("⬆ Mengupload...");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res  = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) { showToast("✖ " + data.error); return; }
      state.pendingFile = data;
      $("file-preview-name").textContent = data.originalname;
      $("file-preview").classList.add("show");
      if (data.mimetype.startsWith("image/")) {
        $("file-preview-thumb").src = data.url;
        $("file-preview-thumb").classList.add("show");
      } else {
        $("file-preview-thumb").classList.remove("show");
      }
      showToast("✔ File siap dikirim");
    } catch (err) { showToast("✖ Upload gagal"); }
    $("file-input").value = "";
  });
});

function clearPendingFile() {
  state.pendingFile = null;
  $("file-preview").classList.remove("show");
  $("file-preview-thumb").classList.remove("show");
  $("file-preview-thumb").src = "";
  $("file-preview-name").textContent = "";
}

// ── Render chat list ──────────────────────────────────────────
function renderChatList() {
  const search     = ($("search-input").value || "").toLowerCase();
  const peers      = Object.keys(state.chats);
  const chatListEl = $("chat-list");

  if (peers.length === 0) {
    chatListEl.innerHTML = `
      <div id="empty-list">
        <div class="empty-icon">💬</div>
        <p>Belum ada percakapan.<br>Tekan <strong>+</strong> untuk mulai chat baru.</p>
      </div>`;
    return;
  }

  const sorted = peers
    .filter((ip) => ip.toLowerCase().includes(search))
    .sort((a, b) => new Date(state.chats[b].lastTime || 0) - new Date(state.chats[a].lastTime || 0));

  chatListEl.innerHTML = sorted.map((ip) => {
    const chat   = state.chats[ip];
    const online = state.onlineIPs.has(ip);
    const unread = chat.unread || 0;
    const active = ip === state.activePeer ? "active" : "";
    return `
      <div class="chat-item ${active}" onclick="openChat('${ip}')">
        <div class="chat-avatar" style="${online ? "" : "filter:grayscale(1);opacity:0.5"}">
          ${ip.split(".").pop()}
        </div>
        <div class="chat-info">
          <div class="chat-ip">${ip}</div>
          <div class="chat-last">${escapeHtml(chat.lastMsg) || "Tidak ada pesan"}</div>
        </div>
        <div class="chat-meta">
          <div class="chat-time">${chat.lastTime ? formatTime(new Date(chat.lastTime)) : ""}</div>
          ${unread > 0 ? `<div class="chat-badge">${unread}</div>` : ""}
        </div>
      </div>`;
  }).join("");
}

// ── Append bubble ─────────────────────────────────────────────
function appendBubble(msg) {
  const isOut = msg.from === state.myIP;
  const row   = document.createElement("div");
  row.className  = "msg-row " + (isOut ? "outgoing" : "incoming");
  row.dataset.id = msg.id;

  let html = "";
  if (msg.file) {
    if (msg.file.mimetype && msg.file.mimetype.startsWith("image/")) {
      html = `<img class="bubble-image"
        src="${msg.file.url}" alt="${escapeHtml(msg.file.originalname)}"
        onclick="openLightbox('${msg.file.url}')" loading="lazy" />`;
    } else {
      html = `<div class="bubble-file">
        <span class="file-icon">${getFileIcon(msg.file.mimetype || "")}</span>
        <div class="file-info">
          <div class="file-name">${escapeHtml(msg.file.originalname)}</div>
          <div class="file-size">${formatBytes(msg.file.size || 0)}</div>
        </div>
        <a href="${msg.file.url}" download="${escapeHtml(msg.file.originalname)}" class="btn-download">⬇ Unduh</a>
      </div>`;
    }
  }
  if (msg.text) html += `<div class="bubble-text">${escapeHtml(msg.text).replace(/\n/g, "<br>")}</div>`;

  row.innerHTML = `<div class="bubble">
    ${!isOut ? `<div class="bubble-from">${escapeHtml(msg.from)}</div>` : ""}
    ${html}
    <div class="bubble-meta"><span class="bubble-time">${formatTime(new Date(msg.timestamp))}</span></div>
  </div>`;
  $("messages-container").appendChild(row);
}

function appendDateDivider(dateStr) {
  const div = document.createElement("div");
  div.className = "date-divider";
  div.innerHTML = `<span>${dateStr}</span>`;
  $("messages-container").appendChild(div);
}

// ── Helpers ───────────────────────────────────────────────────
function scrollToBottom() {
  requestAnimationFrame(() => {
    const mc = $("messages-container");
    if (mc) mc.scrollTop = mc.scrollHeight;
  });
}

function updatePeerStatus() {
  const el = $("peer-status");
  if (!el || !state.activePeer) return;
  const online = state.onlineIPs.has(state.activePeer);
  el.textContent = online ? "● Online" : "○ Offline";
  el.className   = "peer-status" + (online ? "" : " offline");
}

function makeChatId(ip1, ip2) {
  return [ip1, ip2].sort().join("__");
}

function isValidIP(ip) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split(".").every((n) => +n >= 0 && +n <= 255);
}

function formatTime(date) {
  return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(b) {
  if (b < 1024)    return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function getFileIcon(m) {
  if (m.startsWith("video/")) return "🎬";
  if (m.startsWith("audio/")) return "🎵";
  if (m.includes("pdf"))      return "📄";
  if (m.match(/zip|rar|7z/))  return "🗜";
  if (m.match(/word|document/)) return "📝";
  if (m.match(/sheet|excel/))   return "📊";
  return "📎";
}

function showToast(msg) {
  const c = $("toast-container");
  if (!c) return;
  const t = document.createElement("div");
  t.className  = "toast";
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => {
    t.style.opacity    = "0";
    t.style.transition = "opacity 0.3s";
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

function openLightbox(url) {
  $("lightbox-img").src = url;
  $("lightbox").classList.add("show");
}

function autoResizeTextarea() {
  const ta   = $("msg-input");
  ta.style.height = "40px";
  ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
}

// ── Modal new chat ────────────────────────────────────────────
function showNewChatModal() {
  $("modal-new-chat").style.display = "flex";
  $("input-peer-ip").value          = "";
  $("modal-error").classList.remove("show");
  setTimeout(() => $("input-peer-ip").focus(), 80);
}
function hideNewChatModal() { $("modal-new-chat").style.display = "none"; }
function confirmNewChat() {
  const ip    = $("input-peer-ip").value.trim();
  const errEl = $("modal-error");
  if (!isValidIP(ip)) {
    errEl.textContent = "Format IP tidak valid.";
    errEl.classList.add("show"); return;
  }
  if (ip === state.myIP) {
    errEl.textContent = "Tidak bisa chat dengan IP sendiri.";
    errEl.classList.add("show"); return;
  }
  if (!state.chats[ip])
    state.chats[ip] = { messages: [], unread: 0, lastMsg: null, lastTime: null };
  hideNewChatModal();
  renderChatList();
  openChat(ip);
}

// ── DOMContentLoaded ──────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  showSetupScreen();

  $("search-input").addEventListener("input", renderChatList);
  $("btn-new-chat").addEventListener("click", showNewChatModal);
  $("btn-modal-cancel").addEventListener("click", hideNewChatModal);
  $("btn-modal-ok").addEventListener("click", confirmNewChat);
  $("modal-new-chat").addEventListener("click", (e) => {
    if (e.target === $("modal-new-chat")) hideNewChatModal();
  });
  $("input-peer-ip").addEventListener("keydown", (e) => {
    if (e.key === "Enter")  confirmNewChat();
    if (e.key === "Escape") hideNewChatModal();
  });

  $("btn-send").addEventListener("click", sendMessage);
  $("msg-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $("msg-input").addEventListener("input", autoResizeTextarea);
  $("btn-attach").addEventListener("click", () => $("file-input").click());
  $("btn-cancel-file").addEventListener("click", clearPendingFile);
  $("lightbox").addEventListener("click", () => $("lightbox").classList.remove("show"));
  $("btn-back").addEventListener("click", () => {
    $("sidebar").classList.remove("hidden");
    $("chat-area").classList.add("hidden");
    state.activePeer = null;
  });
});
