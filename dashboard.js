import { supabase, ensureSupabaseConfig } from "./supabase.js";

const $ = (sel) => document.querySelector(sel);

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt ?? "";
}
function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html ?? "";
}

function notice(msg, kind = "ok") {
  if (window.__cmpLateBlocked && kind !== "err") return;
  const box = document.getElementById("notice");
  if (!box) return;
  box.className = "notice " + (kind === "err" ? "err" : kind === "warn" ? "warn" : "ok");
  box.style.display = "block";
  box.textContent = msg;
  clearTimeout(window.__cmpNoticeT);
  window.__cmpNoticeT = setTimeout(() => {
    box.style.display = "none";
  }, 4500);
}

function parseISO(s) {
  if (!s) return null;
  // Accept "YYYY-MM-DDTHH:mm" (no seconds) or full ISO.
  // If no timezone, treat as local time.
  try {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) {
      const [d, t] = s.split("T");
      const [Y, M, D] = d.split("-").map(Number);
      const [h, m] = t.split(":").map(Number);
      return new Date(Y, M - 1, D, h, m, 0, 0);
    }
    return new Date(s);
  } catch {
    return null;
  }
}

function fmtLocal(dt) {
  if (!dt || isNaN(dt.getTime())) return "";
  try {
    return dt.toLocaleString("el-GR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return dt.toISOString();
  }
}

function msUntil(dt) {
  if (!dt || isNaN(dt.getTime())) return 0;
  return dt.getTime() - Date.now();
}

function setCountdown(deadlineDate) {
  const pill = document.getElementById("deadlineInfo");
  if (!pill) return;

  // Αν περάσει το deadline ενώ ο χρήστης είναι στη σελίδα, κλείδωσε το UI αμέσως.
  // Η applyLockUI ορίζεται πιο κάτω — την εκθέτουμε στο window ως hook.
  function lockNowIfPossible() {
    try {
      if (typeof window.__cmpApplyLockUI === "function") window.__cmpApplyLockUI(true);
    } catch {}
  }

  function tick() {
    const ms = msUntil(deadlineDate);
    if (ms <= 0) {
      pill.textContent = `Deadline: ${fmtLocal(deadlineDate)} • ⏳ 00:00:00`;
      lockNowIfPossible();
      return;
    }
    const total = Math.floor(ms / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    pill.textContent = `Deadline: ${fmtLocal(deadlineDate)} • ⏳ ${h}:${m}:${s}`;
    requestAnimationFrame(() => {}); // keep UI responsive
    setTimeout(tick, 1000);
  }
  tick();
}

async function safeGetProfile(userId) {
  // Some projects don't have profiles.is_admin column -> avoid breaking.
  const base = supabase.from("profiles");
  let res = await base.select("id, username, is_admin").eq("id", userId).maybeSingle();
  if (res.error && String(res.error.message || "").includes("is_admin")) {
    res = await base.select("id, username").eq("id", userId).maybeSingle();
  }
  if (res.error) return { username: "user", is_admin: false };
  return { username: res.data?.username ?? "user", is_admin: !!res.data?.is_admin };
}

function isDeadlinePassed(deadlineIso) {
  const d = parseISO(deadlineIso);
  if (!d) return false;
  return Date.now() >= d.getTime();
}

function matchTitle(m) {
  const h = m.home ?? m.h ?? "Home";
  const a = m.away ?? m.a ?? "Away";
  return `${h} vs ${a}`;
}

function buildMatchRow(match, pick, disabled) {
  const div = document.createElement("div");
  div.className = "match";
  if (disabled) div.classList.add("locked"); div.style.display="flex"; div.style.justifyContent="space-between"; div.style.alignItems="center"; div.style.gap="10px";

  const left = document.createElement("div");
  left.style.flex="1";
  const title = document.createElement("div");
  title.className = "matchTitle";
  title.textContent = matchTitle(match);

  const time = document.createElement("div");
  time.className = "matchTime";
  const dt = parseISO(match.startISO || match.start_iso || match.kickoff || match.kickoff_iso);
  time.textContent = dt ? fmtLocal(dt) : "";

  left.appendChild(title);
  left.appendChild(time);

  const right = document.createElement("div");
  right.style.display="flex"; right.style.alignItems="center"; right.style.gap="8px";

  const sel = document.createElement("select");
  sel.dataset.matchId = match.id;
  sel.innerHTML = `
    <option value="">Pick: -</option>
    <option value="1">1</option>
    <option value="X">X</option>
    <option value="2">2</option>
  `;
  sel.value = pick ?? "";
  sel.disabled = !!disabled;

const finalEl = document.createElement("span");
finalEl.className = "mini";
finalEl.style.marginLeft = "6px";
finalEl.style.opacity = "0.9";
finalEl.textContent = "Τελικό: —";

const statusEl = document.createElement("span");
statusEl.className = "mini";
statusEl.style.marginLeft = "6px";
statusEl.style.fontWeight = "700";
statusEl.textContent = "";

const btn = document.createElement("button");
  btn.className = "btn"; btn.style.padding="8px 12px";
  btn.textContent = "Save";
  btn.dataset.matchId = match.id;
  btn.disabled = !!disabled;

  

  const helpBtn = document.createElement("button");
  helpBtn.className = "btn"; helpBtn.style.padding="8px 10px";
  helpBtn.textContent = "HELP";
  helpBtn.dataset.matchId = match.id;
  helpBtn.disabled = !!disabled;
right.appendChild(sel);
  right.appendChild(finalEl);
  right.appendChild(statusEl);
  right.appendChild(helpBtn);
  right.appendChild(btn);

  div.appendChild(left);
  div.appendChild(right);

  return { row: div, sel, btn, helpBtn, finalEl, statusEl };
}

async function main() {
  await ensureSupabaseConfig();

  // Guard: must be logged in
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessData?.session?.user) {
    location.href = "login.html";
    return;
  }
  const user = sessData.session.user;

  

  // Stripe redirect success handling
  try {
    const qp = new URLSearchParams(window.location.search);
    if (qp.get("paid") === "1") {
      alert("✅ Η πληρωμή ολοκληρώθηκε! Αν δεν δεις το HELP αμέσως, περίμενε λίγα δευτερόλεπτα και κάνε refresh.");
      qp.delete("paid");
      qp.delete("session_id");
      const qs = qp.toString();
      const cleanUrl = window.location.pathname + (qs ? ("?" + qs) : "");
      window.history.replaceState({}, "", cleanUrl);
    }
  } catch (_) {}
// Wire logout
  const lo = document.getElementById("lo");
  if (lo) {
    lo.addEventListener("click", async () => {
      await supabase.auth.signOut();
      location.href = "login.html";
    });
  }

  const profile = await safeGetProfile(user.id);
  setText("userPill", `Χρήστης: ${profile.username}`);

  // Admin shortcut if available
  if (profile.is_admin) {
    const adminLink = document.getElementById("adminLink");
    if (adminLink) adminLink.style.display = "inline-flex";
  }

  // Load active contest
  const contestRes = await supabase
    .from("contests")
	  .select("id, code, active, current_round, starts_at, locked, deadline_iso, matches, status, published, meta, created_at")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (contestRes.error) {
    console.error(contestRes.error);
    notice("Σφάλμα φόρτωσης διαγωνισμού", "err");
    return;
  }
  const contest = contestRes.data;
  if (!contest) {
    setText("contestInfo", "Contest: -");
    setText("roundInfo", "Αγωνιστική: -");
    notice("Δεν υπάρχει ενεργός διαγωνισμός", "warn");
    return;
  }

  const code = contest.code;
  const round = Number(contest.current_round ?? 1);

  setText("contestInfo", `Contest: ${code}`);
  setText("roundInfo", `Αγωνιστική: ${round}`);

	// Final Week flag (stored in contests.meta.finalWeek)
	try {
		const fw = contest?.meta?.finalWeek === true;
		const el = document.getElementById("finalWeekPill");
		if (el) el.style.display = fw ? "inline-flex" : "none";
	} catch (e) {
		/* no-op */
	}


  // LATE JOIN GUARD (SAFE):
  // Στόχος: όσοι είχαν λογαριασμό ΠΡΙΝ ξεκινήσει ο διαγωνισμός παίζουν.
  // Όσοι κάνουν signup ΜΕΤΑ, βλέπουν μήνυμα και όλα disabled.
  //
  // Χρησιμοποιούμε profiles.created_at (backfilled από auth.users.created_at) ως αξιόπιστο timestamp.
  // Προαιρετικά, αν κάποιος είναι ήδη στο contest_participants, θεωρείται επιτρεπτός.
  let lateBlocked = false;
  try {
    const startsAt = contest.starts_at ? new Date(contest.starts_at) : null;
    const startedOrLocked =
      (startsAt && new Date() >= startsAt) ||
      contest.locked === true ||
      String(contest.status || "").toUpperCase() === "LOCKED";

    if (startedOrLocked && startsAt && !isNaN(startsAt.getTime())) {
      // 1) Πάρε created_at του χρήστη (profiles)
      const profRes = await supabase
        .from("profiles")
        .select("created_at")
        .eq("id", user.id)
        .maybeSingle();

      const userCreatedAt = profRes?.data?.created_at ? new Date(profRes.data.created_at) : null;

      // 2) Προαιρετικά: αν είναι ήδη participant, άσε τον να παίξει
      let isParticipant = false;
      const partRes = await supabase
        .from("contest_participants")
        .select("id")
        .eq("contest_id", contest.id)
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (!partRes?.error && !!partRes?.data) isParticipant = true;

      // 3) Late rule:
      // Αν ΔΕΝ έχουμε created_at (π.χ. δεν έτρεξε το SQL backfill ακόμα), ΔΕΝ μπλοκάρουμε κανέναν (safe).
      // Αν created_at υπάρχει και είναι ΜΕΤΑ το starts_at και δεν είναι participant -> μπλοκάρουμε.
      if (userCreatedAt && !isNaN(userCreatedAt.getTime())) {
        if (userCreatedAt.getTime() > startsAt.getTime() && !isParticipant) {
          lateBlocked = true;
          window.__cmpLateBlocked = true;

          // Persistent banner (χωρίς auto-hide)
          const box = document.getElementById("notice");
          if (box) {
            box.className = "notice warn";
            box.style.display = "block";
            box.textContent = "⛔ Ο διαγωνισμός ξεκίνησε. Θα ενημερώσουμε για τον επόμενο 🙌";
            try { clearTimeout(window.__cmpNoticeT); } catch {}
          }
        }
      }
    }
  } catch (e) {
    console.warn("Late guard check failed:", e);
  }
  const deadlineDate = parseISO(contest.deadline_iso);
  if (deadlineDate) setCountdown(deadlineDate);
  else setText("deadlineInfo", "Deadline: -");

  const deadlinePassed = isDeadlinePassed(contest.deadline_iso);


// Load HELP purchase (ONE per contest) + usage per match
const helpRes = await supabase
  .from("help_purchases")
  .select("remaining, used_match_ids")
  .eq("user_id", user.id)
  .eq("contest_code", code)
  .maybeSingle();

const helpState = {
  remaining: Number(helpRes.data?.remaining || 0),
  used: Array.isArray(helpRes.data?.used_match_ids) ? helpRes.data.used_match_ids : [],
};

  // Load user lock state
  const lockRes = await supabase
    .from("user_round_locks")
    .select("locked, locked_at")
    .eq("user_id", user.id)
    .eq("contest_code", code)
    .eq("round", round)
    .maybeSingle();

  let isLocked = false;
  if (lockRes.data?.locked) isLocked = true;
  if (deadlinePassed) isLocked = true;

  const statusPill = document.getElementById("statusPill");
  if (statusPill) {
    statusPill.textContent = isLocked ? "Κατάσταση: 🔒 Κλειδωμένες" : "Κατάσταση: 🟢 Ανοιχτές";
  }

  // Load existing predictions
  const predsRes = await supabase
    .from("predictions")
    .select("match_id, pick")
    .eq("user_id", user.id)
    .eq("contest_code", code)
    .eq("round", round);

  if (predsRes.error) {
    console.error(predsRes.error);
    notice("Σφάλμα φόρτωσης προβλέψεων", "err");
  }

  const predMap = new Map();
  (predsRes.data || []).forEach((p) => predMap.set(p.match_id, p.pick));


// Load match results (for "Τελικό" + status display)
const mrRes = await supabase
  .from("match_results")
  .select("match_id, result, is_off")
  .eq("contest_code", code)
  .eq("round", round);

if (mrRes.error) {
  console.warn("match_results load error:", mrRes.error);
}

const resultMap = new Map();
(mrRes.data || []).forEach((r) => {
  resultMap.set(String(r.match_id), {
    result: r.result ?? null,
    is_off: !!r.is_off,
  });
});

function computeFinalAndStatus(matchId, pickVal) {
  const mr = resultMap.get(String(matchId));
  const helpUsed = helpState.used.includes(String(matchId));

  if (!mr) return { finalText: "Τελικό: —", statusText: "", kind: "" };

  if (mr.is_off) {
    return {
      finalText: "Τελικό: OFF",
      statusText: helpUsed ? "Σωστό" : "Λάθος",
      kind: helpUsed ? "ok" : "bad",
    };
  }

  if (!mr.result) {
    return {
      finalText: "Τελικό: —",
      statusText: helpUsed ? "HELP" : "",
      kind: helpUsed ? "info" : "",
    };
  }

  const isCorrect = helpUsed || (pickVal && String(pickVal) === String(mr.result));
  return {
    finalText: `Τελικό: ${mr.result}`,
    statusText: pickVal ? (isCorrect ? "Σωστό" : "Λάθος") : "",
    kind: pickVal ? (isCorrect ? "ok" : "bad") : "",
  };
}

  // Render matches
  const matchesBox = document.getElementById("matches");
  if (!matchesBox) return;
  matchesBox.innerHTML = "";

  const matches = Array.isArray(contest.matches) ? contest.matches : [];
  if (!matches.length) {
    matchesBox.innerHTML = `<div class="mini">❌ Δεν υπάρχουν αγώνες.</div>`;
    return;
  }

  // Debounced autosave per match
  const pending = new Map();

  async function upsertPrediction(matchId, pickVal) {
    if (lateBlocked || isLocked) {
      notice("Οι προβλέψεις είναι κλειδωμένες.", "warn");
      return { ok: false };
    }
    if (!lateBlocked && deadlinePassed) {
      notice("Πέρασε το deadline. Δεν μπορείς να αλλάξεις πρόβλεψη.", "warn");
      return { ok: false };
    }
    const payload = {
      user_id: user.id,
      contest_code: code,
      round,
      match_id: matchId,
      pick: pickVal || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("predictions")
      .upsert(payload, { onConflict: "user_id,contest_code,round,match_id" });

    if (error) {
      console.error(error);
      notice("Αποτυχία αποθήκευσης πρόβλεψης.", "err");
      return { ok: false, error };
    }
    if (pickVal) predMap.set(matchId, pickVal);
    else predMap.delete(matchId);
    return { ok: true };
  }

  function scheduleAutosave(matchId, pickVal, btnEl) {
    if (pending.has(matchId)) clearTimeout(pending.get(matchId));
    if (btnEl) {
      btnEl.textContent = "Saving…";
      btnEl.disabled = true;
    }
    pending.set(
      matchId,
      setTimeout(async () => {
        const res = await upsertPrediction(matchId, pickVal);
        if (btnEl) {
          btnEl.textContent = res.ok ? "Saved" : "Save";
          btnEl.disabled = !!isLocked;
          if (res.ok) setTimeout(() => (btnEl.textContent = "Save"), 900);
        }
        if (res.ok) notice("✅ Αποθηκεύτηκε", "ok");
      }, 350)
    );
  }

  for (const m of matches) {
    const matchId = m.id;
    const existingPick = predMap.get(matchId) ?? "";
    const { row, sel, btn, helpBtn, finalEl, statusEl } = buildMatchRow(m, existingPick, isLocked || deadlinePassed || lateBlocked);

    function refreshOutcome() {
      const v = sel.value || "";
      const o = computeFinalAndStatus(matchId, v);
      if (finalEl) finalEl.textContent = o.finalText || "Τελικό: —";
      if (statusEl) {
        statusEl.textContent = o.statusText || "";
        statusEl.style.padding = o.statusText ? "2px 6px" : "0";
        statusEl.style.borderRadius = "999px";
        statusEl.style.border = o.statusText ? "1px solid rgba(255,255,255,.14)" : "none";
        if (o.kind === "ok") statusEl.style.background = "rgba(46,204,113,.18)";
        else if (o.kind === "bad") statusEl.style.background = "rgba(231,76,60,.16)";
        else if (o.kind === "info") statusEl.style.background = "rgba(52,152,219,.14)";
        else statusEl.style.background = "transparent";
      }
    }

    refreshOutcome();

    sel.addEventListener("change", () => {
      const v = sel.value || "";
      scheduleAutosave(matchId, v, btn);
      refreshOutcome();
    });

    btn.addEventListener("click", () => {
      const v = sel.value || "";
      scheduleAutosave(matchId, v, btn);
      refreshOutcome();
    });


// HELP toggle per match (guarantees +1 point for this match no matter result/off)
function renderHelpBtn() {
  const used = helpState.used.includes(matchId);
  if (used) {
    helpBtn.textContent = "HELP ✓";
    helpBtn.style.background = "rgba(52,152,219,.25)";
    helpBtn.style.borderColor = "rgba(52,152,219,.55)";
  } else {
    helpBtn.textContent = "HELP";
    helpBtn.style.background = "";
    helpBtn.style.borderColor = "";
  }
  helpBtn.disabled = !!isLocked || !!deadlinePassed || (!used && helpState.remaining <= 0);
  helpBtn.title = (!used && helpState.remaining <= 0) ? "Δεν έχεις άλλα HELP διαθέσιμα." : "";
}

async function persistHelpState() {
  // Upsert ONE per contest
  const payload = {
    user_id: user.id,
    contest_code: code,
    purchased_at: new Date().toISOString(),
    remaining: helpState.remaining,
    used_match_ids: helpState.used,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("help_purchases")
    .upsert(payload, { onConflict: "user_id,contest_code" });
  if (error) {
    console.error(error);
    notice("❌ Σφάλμα αποθήκευσης HELP.", "err");
    return false;
  }
  return true;
}

helpBtn.addEventListener("click", async () => {
  if (isLocked || deadlinePassed) {
    notice("🔒 Δεν μπορείς να αλλάξεις HELP μετά το κλείδωμα.", "warn");
    return;
  }

  const used = helpState.used.includes(matchId);
  if (!used && helpState.remaining <= 0) {
    notice("Δεν έχεις άλλα HELP διαθέσιμα.", "warn");
    return;
  }

  // toggle
  if (used) {
    helpState.used = helpState.used.filter((x) => x !== matchId);
    helpState.remaining += 1;
  } else {
    helpState.used.push(matchId);
    helpState.remaining -= 1;
  }

  const ok = await persistHelpState();
  if (ok) notice(used ? "↩️ Αφαιρέθηκε HELP από τον αγώνα." : "✅ Έβαλες HELP στον αγώνα.", "ok");
  renderHelpBtn();
  refreshOutcome();
});

renderHelpBtn();

    matchesBox.appendChild(row);
  }

// HELP purchase button (ONE per contest)
const buyBtn = document.getElementById("buyBtn");
if (buyBtn) {
  const alreadyBought = !!helpRes.data;
  buyBtn.disabled = alreadyBought || lateBlocked;
  if (lateBlocked) {
    buyBtn.textContent = "⛔ Ο διαγωνισμός ξεκίνησε";
  } else {
    buyBtn.textContent = alreadyBought ? `✅ HELP ενεργό (${helpState.remaining} διαθέσιμα)` : "🧠 Αγορά HELP (€1,99)";
  }

  
buyBtn.addEventListener("click", async () => {
  try {
    const ok = confirm("Θέλεις να αγοράσεις HELP (€1,99); Θα μεταφερθείς στο Stripe για πληρωμή.");
    if (!ok) return;

    buyBtn.disabled = true;
    const oldText = buyBtn.textContent;
    buyBtn.textContent = "⏳ Μεταφορά στο Stripe...";

    const { data, error } = await supabase.functions.invoke("create-checkout-session", {
      body: { contest_id: contestId }
    });

    if (error) throw error;
    if (!data || !data.url) throw new Error("Δεν πήρα link πληρωμής.");

    window.location.href = data.url;
    // (no return needed)
    buyBtn.textContent = oldText;
  } catch (e) {
    alert("❌ Δεν μπόρεσε να ξεκινήσει η πληρωμή. " + (e?.message || e));
    buyBtn.disabled = false;
    buyBtn.textContent = "🟣 Αγορά HELP (€1,99)";
  }
});

if (error) throw error;

      notice("✅ HELP ενεργοποιήθηκε (3 διαθέσιμα).", "ok");
      setTimeout(() => location.reload(), 450);
    } catch (e) {
      console.error(e);
      notice("❌ Δεν έγινε η αγορά HELP.", "err");
    }
  });
}


  // LOCK button
  const lockBtn = document.getElementById("lockBtn");
  // Apply lock UI state (persist after refresh)
  function applyLockUI(locked) {
    if (!lockBtn) return;
    if (locked) {
      lockBtn.disabled = true;
      lockBtn.classList.add("locked");
      lockBtn.setAttribute("aria-pressed", "true");
      lockBtn.textContent = "🔒 Κλειδωμένες";
      // Visual cue: change color when locked
      lockBtn.style.opacity = "1";
      lockBtn.style.background = "rgba(231, 76, 60, 0.35)";
      lockBtn.style.borderColor = "rgba(231, 76, 60, 0.6)";
      // disable all picks + save buttons when locked
      document.querySelectorAll("#matches select").forEach((el) => (el.disabled = true));
      document.querySelectorAll("#matches button").forEach((el) => (el.disabled = true));

      // make match rows + picks visibly red (like admin finals)
      document.querySelectorAll("#matches .match").forEach((el) => el.classList.add("locked"));
      document.querySelectorAll("#matches select").forEach((el) => el.classList.add("lockedPick"));
    } else {
      lockBtn.disabled = false;
      lockBtn.classList.remove("locked");
      lockBtn.setAttribute("aria-pressed", "false");
      lockBtn.textContent = "🔒 Κλείδωμα προβλέψεων";
      lockBtn.style.background = "";
      lockBtn.style.borderColor = "";

      document.querySelectorAll("#matches .match").forEach((el) => el.classList.remove("locked"));
      document.querySelectorAll("#matches select").forEach((el) => el.classList.remove("lockedPick"));
    }
  }

  // Expose for countdown hook (when deadline passes while staying on page)
  window.__cmpApplyLockUI = applyLockUI;

  // ensure UI matches backend lock state on load
  // Treat deadlinePassed as locked UI as well (same red style)
  applyLockUI(isLocked || lateBlocked || deadlinePassed);

  // Late users: κρατάμε το dashboard αλλά όλα disabled
  if (lateBlocked && lockBtn) {
    lockBtn.disabled = true;
  }


  if (lockBtn) {
    lockBtn.disabled = lateBlocked || deadlinePassed;
    lockBtn.addEventListener("click", async () => {
      // Double confirmation only (do NOT block if some picks are missing)
      if (!confirm("Για ασφάλεια: Είσαι σίγουρος ότι πρόβλεψες σε ΟΛΑ τα παιχνίδια;")) return;
      if (!confirm("Είσαι σίγουρος; Να κλειδώσω τις προβλέψεις σου τώρα;")) return;
      if (lateBlocked) {
        notice("⛔ Ο διαγωνισμός έχει ήδη ξεκινήσει. Θα ενημερώσουμε για τον επόμενο.", "warn");
        applyLockUI(true);
        return;
      }

      if (lateBlocked || isLocked) {
        notice("Ήδη κλειδωμένες.", "warn");
        applyLockUI(true);
        return;
      }
      if (!lateBlocked && deadlinePassed) {
        notice("Πέρασε το deadline. Κλείδωμα αυτόματα.", "warn");
        return;
      }
      try {
        const { error } = await supabase.from("user_round_locks").upsert(
          {
            user_id: user.id,
            contest_code: code,
            round,
            locked: true,
            locked_at: new Date().toISOString(),
          },
          { onConflict: "user_id,contest_code,round" }
        );
        if (error) throw error;
        isLocked = true;
        if (statusPill) statusPill.textContent = "Κατάσταση: 🔒 Κλειδωμένες";
        applyLockUI(true);
        notice("🔒 Κλείδωσες τις προβλέψεις σου!", "ok");
      } catch (e) {
        console.error(e);
        notice("❌ Αποτυχία κλειδώματος.", "err");
      }
    });
  }

  if (!lateBlocked && deadlinePassed) {
    notice("⏳ Έληξε το deadline. Οι προβλέψεις είναι κλειδωμένες.", "warn");
  }
}

main().catch((e) => {
  console.error(e);
  try {
    const box = document.getElementById("notice");
    if (box) {
      box.style.display = "block";
      box.className = "notice err";
      box.textContent = "Fatal error (δες Console).";
    }
  } catch {}
});
