import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

// ── Config ────────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS = "0x44a4Abe0f7e88E858e4c02F3eaA884f4b8Df4a58";
const CHAIN            = studionet;

// StudioNet AI consensus takes 2-5 min; 100 × 5 s = ~8 min ceiling.
const TX_RETRIES  = 100;
const TX_INTERVAL = 5_000;

// ── Clients ───────────────────────────────────────────────────────────────────
const readClient = createClient({ chain: CHAIN });

let provider         = null;   // set once on first connect; listener registered once
let writeClient      = null;
let connectedAddress = null;
let gameActive       = null;
let activeCaseId     = 0;   // current on-chain active_case_id
let viewingCaseId    = 0;   // which case the user is browsing (0 = live active)
let archivesOpen     = false;
let toastTimer       = null;
let txBarTimer       = null;
let phraseTimer      = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const walletBtn           = document.getElementById("wallet-btn");
const walletLabel         = document.getElementById("wallet-label");
const jackpotDisplay      = document.getElementById("jackpot-display");
const statusBadge         = document.getElementById("status-badge");
const statusSub           = document.getElementById("status-sub");
const noCaseMsg           = document.getElementById("no-case-msg");
const caseDetails         = document.getElementById("case-details");
const caseTitleEl         = document.getElementById("case-title");
const caseDescEl          = document.getElementById("case-description");
const suspectRoleEl       = document.getElementById("suspect-role");
const newCaseBtn          = document.getElementById("new-case-btn");
const refreshBtn          = document.getElementById("refresh-btn");
const chatLog             = document.getElementById("chat-log");
const questionInput       = document.getElementById("question-input");
const interrogateBtn      = document.getElementById("interrogate-btn");
const txBarWrap           = document.getElementById("tx-bar-wrap");
const txBarLabel          = document.getElementById("tx-bar-label");
const txBarFill           = document.getElementById("tx-bar-fill");
const toast               = document.getElementById("toast");
const confettiCanvas      = document.getElementById("confetti-canvas");
const archivesToggleBtn   = document.getElementById("archives-toggle-btn");
const archivesChevron     = document.getElementById("archives-chevron");
const archivesPanel       = document.getElementById("archives-panel");
const archivesList        = document.getElementById("archives-list");
const archivesCount       = document.getElementById("archives-count");
const archiveViewBanner   = document.getElementById("archive-view-banner");
const archiveViewLabel    = document.getElementById("archive-view-label");
const archiveBackBtn      = document.getElementById("archive-back-btn");

// ── Loading phrases ───────────────────────────────────────────────────────────
const INTERROGATE_PHRASES = [
  "Analyzing the suspect's body language…",
  "Cross-referencing witness accounts…",
  "Running voice stress analysis…",
  "Decoding encrypted communications…",
  "AI validators reaching consensus…",
  "Building psychological profile…",
  "Tracing financial transactions…",
  "Reviewing surveillance footage…",
  "Consulting forensic analysis…",
  "Validating response on-chain…",
  "Checking for inconsistencies…",
  "Correlating alibis with records…",
];

const NEWCASE_PHRASES = [
  "Generating crime scenario…",
  "Assembling cast of suspects…",
  "Planting evidence trails…",
  "Sealing classified dossier…",
  "Briefing the AI validators…",
  "Initializing interrogation room…",
  "Activating suspect persona…",
  "Writing case file to chain…",
];

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 5000);
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function txBarStart(label = "Waiting for AI consensus…") {
  txBarLabel.textContent = label;
  txBarFill.style.width  = "0%";
  txBarWrap.classList.add("visible");
  let pct = 0;
  clearInterval(txBarTimer);
  txBarTimer = setInterval(() => {
    pct = Math.min(pct + 0.3, 85);
    txBarFill.style.width = pct + "%";
  }, 900);
}

function txBarDone() {
  clearInterval(txBarTimer);
  txBarFill.style.width = "100%";
  setTimeout(() => {
    txBarWrap.classList.remove("visible");
    txBarFill.style.width = "0%";
  }, 600);
}

// ── Immersive loading screen ──────────────────────────────────────────────────
function showLoadingScreen(context = "interrogate") {
  clearInterval(phraseTimer);
  hideLoadingScreen();

  const phrases = context === "newcase" ? NEWCASE_PHRASES : INTERROGATE_PHRASES;
  let idx = 0;

  const screen = document.createElement("div");
  screen.id = "loading-screen";
  screen.innerHTML = `
    <div class="load-rings">
      <div class="load-ring r1"></div>
      <div class="load-ring r2"></div>
      <div class="load-ring r3"></div>
      <div class="load-icon">⚿</div>
    </div>
    <div class="scan-beam"></div>
    <div class="load-phrase">${phrases[0]}</div>
    <div class="load-sublabel">AI Consensus · StudioNet</div>
  `;
  chatLog.appendChild(screen);
  chatLog.scrollTop = chatLog.scrollHeight;

  const phraseEl = screen.querySelector(".load-phrase");
  phraseTimer = setInterval(() => {
    phraseEl.style.opacity = "0";
    setTimeout(() => {
      idx = (idx + 1) % phrases.length;
      phraseEl.textContent = phrases[idx];
      phraseEl.style.opacity = "1";
    }, 300);
  }, 3500);
}

function hideLoadingScreen() {
  clearInterval(phraseTimer);
  document.getElementById("loading-screen")?.remove();
}

// ── 3D tilt cards ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tilt-card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    const dx   = (e.clientX - rect.left - rect.width  / 2) / (rect.width  / 2);
    const dy   = (e.clientY - rect.top  - rect.height / 2) / (rect.height / 2);
    card.style.transform = `perspective(900px) rotateX(${-dy * 4}deg) rotateY(${dx * 5}deg)`;
    card.style.boxShadow = `
      ${-dx * 10}px ${dy * 10}px 36px rgba(168,85,247,.14),
      0 4px 24px rgba(0,0,0,.4),
      inset 0 1px 0 rgba(255,255,255,.04)
    `;
  });
  card.addEventListener("mouseleave", () => {
    card.style.transform = "";
    card.style.boxShadow = "";
  });
});

// ── Status board ──────────────────────────────────────────────────────────────
function applyStatus(jackpot, active, caseTitle, caseDesc, suspectRole, caseId) {
  jackpotDisplay.textContent = Number(jackpot).toLocaleString();
  gameActive   = active;
  activeCaseId = caseId ?? activeCaseId;

  if (!caseTitle) {
    statusBadge.textContent = "⏳ No Case";
    statusBadge.className   = "status-badge badge-setup";
    statusSub.textContent   = "Generate a new case to begin.";
    noCaseMsg.style.display   = "block";
    caseDetails.style.display = "none";
    interrogateBtn.disabled   = true;
    questionInput.disabled    = true;
  } else if (active) {
    statusBadge.textContent = "🟢 Active";
    statusBadge.className   = "status-badge badge-active";
    statusSub.textContent   = "The suspect is ready to be questioned.";
    if (connectedAddress && viewingCaseId === activeCaseId) {
      interrogateBtn.disabled = false;
      questionInput.disabled  = false;
    }
  } else {
    statusBadge.textContent = "🔴 Solved";
    statusBadge.className   = "status-badge badge-solved";
    statusSub.textContent   = "Case closed. Generate a new case to continue.";
    interrogateBtn.disabled = true;
    questionInput.disabled  = true;
  }

  // Only update the dossier display when viewing the live active case
  if (caseTitle && viewingCaseId === activeCaseId) {
    caseTitleEl.textContent   = caseTitle;
    caseDescEl.textContent    = caseDesc;
    suspectRoleEl.textContent = suspectRole;
    noCaseMsg.style.display   = "none";
    caseDetails.style.display = "block";
  }
}

// Force-render the dossier from a status object, regardless of viewingCaseId.
// Call this after syncing viewingCaseId = activeCaseId so the guard in
// applyStatus() doesn't silently skip the update.
function applyDossier(status) {
  if (!status?.case_title) return;
  caseTitleEl.textContent   = status.case_title;
  caseDescEl.textContent    = status.case_description ?? "";
  suspectRoleEl.textContent = status.suspect_role     ?? "";
  noCaseMsg.style.display   = "none";
  caseDetails.style.display = "block";
}

// ── Fetch game status ─────────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const r = await readClient.readContract({
      address:      CONTRACT_ADDRESS,
      functionName: "get_game_status",
      args:         [],
    });
    applyStatus(
      r.jackpot_pool,
      r.game_active,
      r.case_title,
      r.case_description,
      r.suspect_role,
      r.active_case_id ?? 0,
    );
    return r;
  } catch (err) {
    showToast(`Status read failed: ${err.message ?? err}`);
    return null;
  }
}

// ── Chat history ──────────────────────────────────────────────────────────────
function clearPlaceholder() {
  chatLog.querySelector(".chat-placeholder")?.remove();
}

function appendBubble(role, text, mod = "") {
  clearPlaceholder();
  const wrapper = document.createElement("div");
  wrapper.className = `bubble bubble-${role}${mod ? " " + mod : ""}`;

  if (role === "detective" || role === "suspect") {
    const roleEl = document.createElement("div");
    roleEl.className   = "bubble-role";
    roleEl.textContent = role === "detective" ? "🔍 Detective" : "🕵 Suspect";
    wrapper.appendChild(roleEl);
  }

  const textEl = document.createElement("div");
  textEl.className   = "bubble-text";
  textEl.textContent = text;
  wrapper.appendChild(textEl);
  chatLog.appendChild(wrapper);
  chatLog.scrollTop = chatLog.scrollHeight;
  return textEl;
}

function renderHistory(history) {
  chatLog.innerHTML = "";

  if (!history || history.length === 0) {
    chatLog.innerHTML = `
      <div class="chat-placeholder">
        No interrogation history yet.<br>
        <span style="font-size:.65rem">⚿ &nbsp;Ask your first question below.</span>
      </div>`;
    return;
  }

  for (const entry of history) {
    appendBubble("detective", entry.q ?? "");
    const isWin = (entry.a ?? "").startsWith("[WIN]");
    appendBubble("suspect", entry.a ?? "", isWin ? "bubble-win" : "");
  }
}

// Fetch and render chat history — respects viewingCaseId vs activeCaseId.
async function fetchAndRenderHistory() {
  if (!connectedAddress) return;
  try {
    let history;
    if (viewingCaseId !== 0 && viewingCaseId !== activeCaseId) {
      history = await readClient.readContract({
        address:      CONTRACT_ADDRESS,
        functionName: "get_case_chat_history",
        args:         [connectedAddress.toLowerCase(), viewingCaseId],
      });
    } else {
      history = await readClient.readContract({
        address:      CONTRACT_ADDRESS,
        functionName: "get_chat_history",
        args:         [connectedAddress.toLowerCase()],
      });
    }
    renderHistory(Array.isArray(history) ? history : []);
  } catch (err) {
    showToast(`History read failed: ${err.message ?? err}`);
  }
}

// ── Archives vault ────────────────────────────────────────────────────────────
function renderPlayerCases(cases) {
  if (!cases || cases.length === 0) {
    archivesList.innerHTML = `<div class="archives-empty">No archived cases yet.</div>`;
    archivesCount.textContent = "0 cases";
    return;
  }

  archivesCount.textContent = `${cases.length} case${cases.length !== 1 ? "s" : ""}`;
  archivesList.innerHTML = "";

  for (const c of cases) {
    const item = document.createElement("div");
    item.className = `archive-item${c.case_id === viewingCaseId ? " active-archive" : ""}`;
    item.dataset.caseId = c.case_id;
    item.innerHTML = `
      <div class="archive-id">Case #${c.case_id}</div>
      <div class="archive-title">${c.title}</div>
      <div class="archive-role">${c.suspect_role}</div>
    `;
    item.addEventListener("click", () => loadArchivedCase(c));
    archivesList.appendChild(item);
  }
}

async function fetchPlayerCases() {
  if (!connectedAddress) return;
  try {
    const raw = await readClient.readContract({
      address:      CONTRACT_ADDRESS,
      functionName: "get_player_cases",
      args:         [connectedAddress.toLowerCase()],
    });

    // Normalise: SDK may return the list as a JSON string or as a parsed array.
    let cases = Array.isArray(raw) ? raw : [];
    if (typeof raw === "string") {
      try { cases = JSON.parse(raw); } catch { cases = []; }
    }

    // Normalise each item: if the SDK returns items as JSON strings, parse them.
    cases = cases.map((c) => {
      if (typeof c === "string") { try { return JSON.parse(c); } catch { return null; } }
      return c;
    }).filter(Boolean);

    renderPlayerCases(cases);
    archivesToggleBtn.disabled = false;
  } catch (err) {
    showToast(`Archives read failed: ${err.message ?? err}`);
  }
}

async function loadArchivedCase(caseRecord) {
  const id = caseRecord.case_id;

  // Update dossier display with archived case data
  caseTitleEl.textContent   = caseRecord.title;
  caseDescEl.textContent    = caseRecord.description;
  suspectRoleEl.textContent = caseRecord.suspect_role;
  noCaseMsg.style.display   = "none";
  caseDetails.style.display = "block";

  viewingCaseId = id;

  // Highlight the selected archive item
  archivesList.querySelectorAll(".archive-item").forEach((el) => {
    el.classList.toggle("active-archive", Number(el.dataset.caseId) === id);
  });

  // Show or hide the "viewing archive" banner
  const isLiveCase = id === activeCaseId;
  if (isLiveCase) {
    archiveViewBanner.classList.remove("visible");
    if (connectedAddress && gameActive) {
      interrogateBtn.disabled = false;
      questionInput.disabled  = false;
    }
  } else {
    archiveViewLabel.textContent = `Viewing Case #${id}: ${caseRecord.title}`;
    archiveViewBanner.classList.add("visible");
    interrogateBtn.disabled = true;
    questionInput.disabled  = true;
  }

  await fetchAndRenderHistory();
}

function returnToActiveCase() {
  viewingCaseId = activeCaseId;
  archiveViewBanner.classList.remove("visible");

  // Restore active case dossier display
  fetchStatus().then(() => fetchAndRenderHistory());

  // Re-highlight active item in archives list
  archivesList.querySelectorAll(".archive-item").forEach((el) => {
    el.classList.toggle("active-archive", Number(el.dataset.caseId) === activeCaseId);
  });
}

// Toggle archives panel open/close
archivesToggleBtn.addEventListener("click", () => {
  archivesOpen = !archivesOpen;
  archivesPanel.style.display = archivesOpen ? "block" : "none";
  archivesChevron.classList.toggle("open", archivesOpen);
  if (archivesOpen) fetchPlayerCases();
});

archiveBackBtn.addEventListener("click", returnToActiveCase);

// ── Wallet connection ─────────────────────────────────────────────────────────

// Register the accountsChanged listener exactly once, the first time a provider
// is obtained. Re-clicking "Connect Wallet" reuses the same provider reference
// and never adds a duplicate listener.
function initProvider(p) {
  if (provider) return;   // already set up
  provider = p;
  provider.on?.("accountsChanged", async (accs) => {
    if (!accs.length) {
      resetWallet();
      return;
    }
    const incoming = accs[0].toLowerCase();
    if (incoming === connectedAddress?.toLowerCase()) return; // same account, no-op

    // Switched to a different wallet — rebuild everything for the new address.
    connectedAddress = accs[0];
    writeClient = createClient({ chain: CHAIN, account: connectedAddress, provider });
    await reloadWalletState();
  });
}

async function connectWallet() {
  const detected = window.genlayer ?? window.ethereum;
  if (!detected) {
    showToast("No Web3 wallet detected. Please install the GenLayer browser extension.");
    return;
  }

  walletLabel.textContent = "Connecting…";
  walletBtn.disabled      = true;

  try {
    const accounts = await detected.request({ method: "eth_requestAccounts" });
    connectedAddress = accounts[0];
    initProvider(detected);   // registers listener once; no-ops on repeat clicks

    writeClient = createClient({
      chain:    CHAIN,
      account:  connectedAddress,
      provider,
    });

    await reloadWalletState();

  } catch (err) {
    walletLabel.textContent = "Connect Wallet";
    walletBtn.classList.remove("connected");
    walletBtn.disabled = false;
    showToast(`Connection failed: ${err.message ?? err}`);
  }
}

// Clear every piece of wallet-specific UI without touching wallet credentials.
function clearWalletUI() {
  viewingCaseId  = 0;
  activeCaseId   = 0;
  gameActive     = null;
  archivesOpen   = false;

  // Reset dossier
  caseTitleEl.textContent   = "";
  caseDescEl.textContent    = "";
  suspectRoleEl.textContent = "";
  noCaseMsg.style.display   = "block";
  caseDetails.style.display = "none";

  // Reset status board
  statusBadge.textContent = "⏳ No Case";
  statusBadge.className   = "status-badge badge-setup";
  statusSub.textContent   = "Loading…";
  jackpotDisplay.textContent = "—";

  // Reset chat log
  chatLog.innerHTML = `
    <div class="chat-placeholder">
      [ Connect your wallet to load interrogation history ]<br>
      <span style="font-size:.66rem">⚿ &nbsp;The suspect awaits…</span>
    </div>`;

  // Reset archives panel
  archivesPanel.style.display   = "none";
  archivesChevron.classList.remove("open");
  archivesCount.textContent     = "—";
  archivesList.innerHTML        = `<div class="archives-empty">No archived cases yet.</div>`;
  archiveViewBanner.classList.remove("visible");

  // Reset inputs
  interrogateBtn.disabled    = true;
  questionInput.disabled     = true;
  questionInput.value        = "";
  archivesToggleBtn.disabled = true;
}

function resetWallet() {
  clearWalletUI();
  connectedAddress        = null;
  writeClient             = null;
  walletLabel.textContent = "Connect Wallet";
  walletBtn.classList.remove("connected");
  walletBtn.disabled      = false;
  newCaseBtn.disabled     = true;
  statusSub.textContent   = "Connect wallet to begin";
}

// Re-fetch all on-chain state for the currently connected address.
async function reloadWalletState() {
  clearWalletUI();

  const short = `${connectedAddress.slice(0, 6)}…${connectedAddress.slice(-4)}`;
  walletLabel.textContent = short;
  walletBtn.classList.add("connected");
  walletBtn.disabled  = false;
  newCaseBtn.disabled = false;

  const status = await fetchStatus();
  viewingCaseId = activeCaseId;   // sync BEFORE dossier paint
  applyDossier(status);           // force-paint dossier now that viewingCaseId is correct
  await fetchAndRenderHistory();
  await fetchPlayerCases();

  if (status?.game_active && chatLog.querySelector(".chat-placeholder")) {
    appendBubble("suspect",
      "You have my attention, detective. Choose your words carefully.");
  }
}

// ── New case ──────────────────────────────────────────────────────────────────
async function handleNewCase() {
  if (!writeClient) { showToast("Connect your wallet first."); return; }

  newCaseBtn.disabled     = true;
  interrogateBtn.disabled = true;
  questionInput.disabled  = true;
  archiveViewBanner.classList.remove("visible");

  chatLog.innerHTML = "";
  showLoadingScreen("newcase");
  txBarStart("Generating case via AI consensus…");

  try {
    const txHash = await writeClient.writeContract({
      address:      CONTRACT_ADDRESS,
      functionName: "setup_new_case",
      args:         [],
    });

    await writeClient.waitForTransactionReceipt({
      hash:     txHash,
      status:   TransactionStatus.FINALIZED,
      retries:  TX_RETRIES,
      interval: TX_INTERVAL,
    });

    txBarDone();
    hideLoadingScreen();

    const status = await fetchStatus();
    viewingCaseId = activeCaseId;   // sync BEFORE dossier paint
    applyDossier(status);           // force-paint title + description + suspect role
    await fetchAndRenderHistory();
    await fetchPlayerCases();       // refresh archives list

    if (status?.game_active) {
      appendBubble("info",
        `New case opened: "${status.case_title}"`, "bubble-info");
      appendBubble("suspect",
        "You have my attention, detective. Ask your questions — I have nothing to hide.");
    }

  } catch (err) {
    txBarDone();
    hideLoadingScreen();
    const msg = err.message ?? String(err);
    showToast(`Case generation failed: ${msg}`);
    appendBubble("system", `Error: ${msg}`, "bubble-err");
  } finally {
    newCaseBtn.disabled = !connectedAddress;
    const active = gameActive === true;
    interrogateBtn.disabled = !active || !connectedAddress;
    questionInput.disabled  = !active || !connectedAddress;
    if (active && connectedAddress) questionInput.focus();
  }
}

// ── Interrogate ───────────────────────────────────────────────────────────────
async function handleInterrogate() {
  const question = questionInput.value.trim();
  if (!question)          { showToast("Type a question first."); return; }
  if (!writeClient)       { showToast("Connect your wallet first."); return; }
  if (gameActive === false) { showToast("No active case. Generate a new one."); return; }

  interrogateBtn.disabled = true;
  questionInput.disabled  = true;
  questionInput.value     = "";

  appendBubble("detective", question);
  showLoadingScreen("interrogate");
  txBarStart("Waiting for AI consensus…");

  try {
    const txHash = await writeClient.writeContract({
      address:      CONTRACT_ADDRESS,
      functionName: "interrogate",
      args:         [question],
    });

    await writeClient.waitForTransactionReceipt({
      hash:     txHash,
      status:   TransactionStatus.FINALIZED,
      retries:  TX_RETRIES,
      interval: TX_INTERVAL,
    });

    txBarDone();
    hideLoadingScreen();

    const wasActive = gameActive;          // snapshot before fetchStatus mutates it
    await fetchAndRenderHistory();
    const status = await fetchStatus();

    if (status && !status.game_active && wasActive !== false) {
      appendBubble("system",
        "🏆  CASE SOLVED — Jackpot awarded to the detective!", "bubble-win");
      celebrate();
    }

  } catch (err) {
    txBarDone();
    hideLoadingScreen();
    const msg = err.message ?? String(err);

    if (msg.includes("[EXPECTED] Game is not active")) {
      appendBubble("system",
        "The investigation is closed. Generate a new case to continue.", "bubble-err");
      await fetchStatus();
    } else {
      appendBubble("system", `Transaction failed: ${msg}`, "bubble-err");
      showToast("Transaction failed — see the log above.");
    }
  } finally {
    const active = gameActive !== false && Boolean(connectedAddress)
                   && viewingCaseId === activeCaseId;
    interrogateBtn.disabled = !active;
    questionInput.disabled  = !active;
    if (active) questionInput.focus();
  }
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function celebrate() {
  const ctx = confettiCanvas.getContext("2d");
  confettiCanvas.width  = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
  const W = confettiCanvas.width, H = confettiCanvas.height;
  const palette = ["#f0a500","#ffe066","#2dd882","#60a5fa","#f87171","#c084fc"];
  const pieces  = Array.from({ length: 160 }, () => ({
    x:     Math.random() * W,
    y:     Math.random() * H - H,
    r:     Math.random() * 5 + 3,
    speed: Math.random() * 2 + 0.8,
    angle: 0,
    spin:  (Math.random() - 0.5) * 0.14,
    tilt:  Math.random() * 12 - 6,
    color: palette[Math.floor(Math.random() * palette.length)],
  }));
  let raf, elapsed = 0;
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    elapsed++;
    for (const p of pieces) {
      p.angle += p.spin; p.y += p.speed; p.x += Math.sin(p.angle); p.tilt = Math.sin(p.angle) * 13;
      ctx.beginPath();
      ctx.lineWidth   = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();
    }
    if (elapsed < 240) { raf = requestAnimationFrame(draw); }
    else { ctx.clearRect(0, 0, W, H); }
  };
  cancelAnimationFrame(raf);
  draw();
}

// ── Keyboard shortcut ─────────────────────────────────────────────────────────
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!interrogateBtn.disabled) handleInterrogate();
  }
});

// ── Event wiring ──────────────────────────────────────────────────────────────
walletBtn.addEventListener("click", connectWallet);
newCaseBtn.addEventListener("click", handleNewCase);
interrogateBtn.addEventListener("click", handleInterrogate);
refreshBtn.addEventListener("click", async () => {
  await fetchStatus();
  if (connectedAddress) {
    await fetchAndRenderHistory();
    await fetchPlayerCases();
  }
});

// ── Boot: pre-load public state without wallet ────────────────────────────────
fetchStatus();
