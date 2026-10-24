const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const crypto = require("crypto");

initializeApp({ databaseURL: "https://vexo-v2-default-rtdb.firebaseio.com" });
const db = getDatabase();
const COINS = ["gold", "silver", "bronze", "vxb"];
const DAY_CAP_VXB = 1000; // VXB rewards per user per UTC day; admin issuance is separate.
const moves = ["rock", "paper", "scissors"];
const today = () => new Date().toISOString().slice(0, 10);
const safeText = (v, max = 40) => String(v || "").trim().slice(0, max);
function requireAuth(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please sign in first.");
  return req.auth.uid;
}
async function requireAdmin(uid) {
  const snap = await db.ref(`admins/${uid}`).get();
  if (snap.val() !== true) throw new HttpsError("permission-denied", "Admin access is not enabled for this account.");
}
function initialProfile(uid, email, username, displayName) {
  const now = new Date().toISOString();
  return {
    uid, email, username, displayName, bio: "", createdAt: now, updatedAt: now,
    coins: { gold: 0, silver: 250, bronze: 500, vxb: 100 },
    stats: { games: 0, wins: 0, losses: 0, draws: 0, netVxb: 0, streak: 0 },
    daily: { day: today(), earnedVxb: 0, airdropDay: "" },
    status: "active"
  };
}
function tx(uid, type, amount, coin, direction, ref) {
  return { id: crypto.randomUUID(), type, amount, coin, direction, ref, createdAt: new Date().toISOString(), status: "confirmed" };
}


exports.checkUsername = onCall(async (request) => {
  const username = safeText(request.data?.username, 24).toLowerCase();
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) throw new HttpsError("invalid-argument", "Invalid username.");
  const snap = await db.ref(`usernames/${username}`).get();
  return { available: !snap.exists() };
});

exports.initializeProfile = onCall(async (request) => {
  const uid = requireAuth(request);
  const email = String(request.auth.token.email || "").toLowerCase();
  const username = safeText(request.data?.username, 24).toLowerCase();
  const displayName = safeText(request.data?.displayName, 48);
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) throw new HttpsError("invalid-argument", "Username must be 3–24 letters, numbers, dots, dashes or underscores.");
  if (displayName.length < 2) throw new HttpsError("invalid-argument", "Enter a display name.");
  const existing = await db.ref(`users/${uid}`).get();
  if (existing.exists()) return { ok: true, profile: existing.val() };
  const usernameRef = db.ref(`usernames/${username}`);
  const claimed = await usernameRef.transaction(current => current === null ? uid : undefined);
  if (!claimed.committed) throw new HttpsError("already-exists", "That username is already taken.");
  const profile = initialProfile(uid, email, username, displayName);
  try {
    await db.ref(`users/${uid}`).set(profile);
    await db.ref(`transactions/${uid}`).push(tx(uid, "Welcome credits", 100, "VXB", "in", "WELCOME"));
  } catch (e) {
    await usernameRef.remove();
    throw new HttpsError("internal", "Could not create the profile. Please try again.");
  }
  return { ok: true, profile };
});

exports.updateProfile = onCall(async (request) => {
  const uid = requireAuth(request);
  const displayName = safeText(request.data?.displayName, 48);
  const bio = safeText(request.data?.bio, 240);
  if (displayName.length < 2) throw new HttpsError("invalid-argument", "Display name must contain at least 2 characters.");
  const ref = db.ref(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists()) throw new HttpsError("failed-precondition", "Profile not initialized.");
  await ref.update({ displayName, bio, updatedAt: new Date().toISOString() });
  return { ok: true };
});

exports.playBot = onCall(async (request) => {
  const uid = requireAuth(request);
  const move = String(request.data?.move || "");
  if (!moves.includes(move)) throw new HttpsError("invalid-argument", "Invalid move.");
  const cpu = moves[crypto.randomInt(0, moves.length)];
  const win = (move === "rock" && cpu === "scissors") || (move === "paper" && cpu === "rock") || (move === "scissors" && cpu === "paper");
  const result = move === cpu ? "draw" : win ? "win" : "loss";
  const delta = result === "win" ? 25 : result === "loss" ? -8 : -2;
  const ref = db.ref(`users/${uid}`);
  let outProfile, roundDelta = 0;
  const resultTx = await ref.transaction(u => {
    if (!u || !u.coins) return;
    const day = today();
    if (!u.daily || u.daily.day !== day) u.daily = { day, earnedVxb: 0, airdropDay: "" };
    if (!u.stats) u.stats = { games: 0, wins: 0, losses: 0, draws: 0, netVxb: 0, streak: 0 };
    if (delta < 0 && Number(u.coins.vxb || 0) < -delta) return;
    let actualDelta = delta;
    if (delta > 0) actualDelta = Math.min(delta, Math.max(0, DAY_CAP_VXB - Number(u.daily.earnedVxb || 0)));
    roundDelta = actualDelta;
    u.coins.vxb = Math.max(0, Number(u.coins.vxb || 0) + actualDelta);
    if (actualDelta > 0) u.daily.earnedVxb = Number(u.daily.earnedVxb || 0) + actualDelta;
    u.stats.games = Number(u.stats.games || 0) + 1;
    u.stats.netVxb = Number(u.stats.netVxb || 0) + actualDelta;
    if (result === "win") { u.stats.wins = Number(u.stats.wins || 0) + 1; u.stats.streak = Number(u.stats.streak || 0) + 1; }
    else if (result === "loss") { u.stats.losses = Number(u.stats.losses || 0) + 1; u.stats.streak = 0; }
    else u.stats.draws = Number(u.stats.draws || 0) + 1;
    u.updatedAt = new Date().toISOString();
    return u;
  });
  if (!resultTx.committed) throw new HttpsError("failed-precondition", "Not enough VXB or profile not found.");
  outProfile = resultTx.snapshot.val();
  await db.ref(`transactions/${uid}`).push(tx(uid, `RPS ${result}`, Math.abs(roundDelta), "VXB", roundDelta >= 0 ? "in" : "out", `BOT-${move}-${cpu}`));
  return { result, playerMove: move, rivalMove: cpu, delta: roundDelta, profile: outProfile };
});

exports.claimAirdrop = onCall(async (request) => {
  const uid = requireAuth(request);
  const reward = crypto.randomInt(20, 81);
  const ref = db.ref(`users/${uid}`);
  let actual = 0, outProfile;
  const result = await ref.transaction(u => {
    if (!u || !u.coins) return;
    const day = today();
    if (!u.daily || u.daily.day !== day) u.daily = { day, earnedVxb: 0, airdropDay: "" };
    if (u.daily.airdropDay === day) return;
    actual = Math.min(reward, Math.max(0, DAY_CAP_VXB - Number(u.daily.earnedVxb || 0)));
    if (actual <= 0) return;
    u.coins.vxb = Number(u.coins.vxb || 0) + actual;
    u.daily.earnedVxb = Number(u.daily.earnedVxb || 0) + actual;
    u.daily.airdropDay = day;
    u.updatedAt = new Date().toISOString();
    return u;
  });
  if (!result.committed) throw new HttpsError("failed-precondition", "Airdrop already claimed, daily cap reached, or profile missing.");
  outProfile = result.snapshot.val();
  await db.ref(`transactions/${uid}`).push(tx(uid, "Daily VXB airdrop", actual, "VXB", "in", "AIRDROP"));
  return { reward: actual, profile: outProfile };
});

exports.adminListUsers = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireAdmin(uid);
  const snap = await db.ref("users").get();
  return { users: snap.val() || {} };
});

exports.adminAdjustCoins = onCall(async (request) => {
  const adminUid = requireAuth(request);
  await requireAdmin(adminUid);
  const targetUid = safeText(request.data?.uid, 128);
  const coin = String(request.data?.coin || "");
  const amount = Number(request.data?.amount);
  const direction = String(request.data?.direction || "");
  if (!targetUid || !COINS.includes(coin) || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000 || !["in", "out"].includes(direction)) {
    throw new HttpsError("invalid-argument", "Invalid coin adjustment.");
  }
  const userRef = db.ref(`users/${targetUid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists()) throw new HttpsError("not-found", "User not found.");
  if (direction === "in" && coin === "gold") {
    const budgetRef = db.ref(`system/goldIssuance/${today()}`);
    const budgetResult = await budgetRef.transaction(current => {
      const used = Number(current?.used || 0);
      if (used + amount > 100) return;
      return { used: used + amount, updatedAt: new Date().toISOString() };
    });
    if (!budgetResult.committed) throw new HttpsError("resource-exhausted", "Daily admin Gold issuance limit is 100 Gold.");
  }
  const result = await userRef.transaction(u => {
    if (!u || !u.coins) return;
    if (direction === "out" && Number(u.coins[coin] || 0) < amount) return;
    u.coins[coin] = Number(u.coins[coin] || 0) + (direction === "in" ? amount : -amount);
    u.updatedAt = new Date().toISOString();
    return u;
  });
  if (!result.committed) throw new HttpsError("failed-precondition", "Adjustment could not be applied.");
  await db.ref(`transactions/${targetUid}`).push(tx(targetUid, `Admin ${direction === "in" ? "grant" : "deduction"}`, amount, coin.toUpperCase(), direction, `ADMIN-${adminUid}`));
  await db.ref(`system/adminAudit`).push({ adminUid, targetUid, coin, amount, direction, createdAt: new Date().toISOString() });
  return { ok: true, profile: result.snapshot.val() };
});

exports.adminGetMetrics = onCall(async (request) => {
  const uid = requireAuth(request);
  await requireAdmin(uid);
  const [usersSnap, issuanceSnap, auditSnap] = await Promise.all([
    db.ref("users").get(), db.ref(`system/goldIssuance/${today()}`).get(), db.ref("system/adminAudit").limitToLast(30).get()
  ]);
  const users = usersSnap.val() || {};
  let totalVxb = 0;
  for (const u of Object.values(users)) totalVxb += Number(u?.coins?.vxb || 0);
  return { totalUsers: Object.keys(users).length, totalVxb, goldIssuedToday: Number(issuanceSnap.val()?.used || 0), audit: auditSnap.val() || {} };
});

exports.getLeaderboard = onCall(async (request) => {
  requireAuth(request);
  const snap = await db.ref("users").get();
  const users = snap.val() || {};
  return { users: Object.values(users).map(u => ({
    uid: u.uid, username: u.username, displayName: u.displayName,
    coins: { gold: Number(u.coins?.gold || 0), silver: Number(u.coins?.silver || 0), bronze: Number(u.coins?.bronze || 0), vxb: Number(u.coins?.vxb || 0) },
    stats: { games: Number(u.stats?.games || 0), wins: Number(u.stats?.wins || 0) }
  })).sort((a,b) => (b.coins.vxb + b.coins.gold*2000000 + b.coins.silver*2000 + b.coins.bronze/1000) - (a.coins.vxb + a.coins.gold*2000000 + a.coins.silver*2000 + a.coins.bronze/1000)).slice(0, 20) };
});

const MATCH_STAKE = 40;
exports.joinMultiplayer = onCall(async (request) => {
  const uid = requireAuth(request);
  const selfSnap = await db.ref(`users/${uid}`).get();
  if (!selfSnap.exists()) throw new HttpsError("failed-precondition", "Profile missing.");
  if (Number(selfSnap.val()?.coins?.vxb || 0) < MATCH_STAKE) throw new HttpsError("failed-precondition", `Online matches require ${MATCH_STAKE} VXB to stake.`);
  const queueRef = db.ref("matchmaking/waiting");
  let opponentUid = null;
  const qResult = await queueRef.transaction(queue => {
    queue = queue && typeof queue === "object" ? queue : {};
    opponentUid = Object.keys(queue).find(id => id !== uid && Date.now() - Number(queue[id]?.joinedAt || 0) < 120000) || null;
    if (opponentUid) {
      delete queue[opponentUid];
      delete queue[uid];
    } else {
      queue[uid] = { joinedAt: Date.now() };
    }
    return queue;
  });
  if (!qResult.committed) throw new HttpsError("aborted", "Could not join matchmaking. Try again.");
  if (!opponentUid) return { status: "waiting" };
  const opponentSnap = await db.ref(`users/${opponentUid}`).get();
  if (!opponentSnap.exists() || Number(opponentSnap.val()?.coins?.vxb || 0) < MATCH_STAKE) {
    await queueRef.child(uid).set({ joinedAt: Date.now() });
    return { status: "waiting" };
  }
  const matchRef = db.ref("matches").push();
  const matchId = matchRef.key;
  const match = { matchId, players: { [uid]: true, [opponentUid]: true }, moves: {}, status: "preparing", stake: MATCH_STAKE, createdAt: new Date().toISOString() };
  await matchRef.set(match);
  async function reserve(playerUid) {
    const userRef = db.ref(`users/${playerUid}`);
    const r = await userRef.transaction(u => {
      if (!u || !u.coins || Number(u.coins.vxb || 0) < MATCH_STAKE) return;
      u.coins.vxb = Number(u.coins.vxb) - MATCH_STAKE;
      u.updatedAt = new Date().toISOString();
      return u;
    });
    if (r.committed) await db.ref(`transactions/${playerUid}`).push(tx(playerUid, "Online match stake", MATCH_STAKE, "VXB", "out", matchId));
    return r.committed;
  }
  const firstReserved = await reserve(uid);
  const secondReserved = firstReserved ? await reserve(opponentUid) : false;
  if (!firstReserved || !secondReserved) {
    if (firstReserved) {
      await db.ref(`users/${uid}/coins/vxb`).transaction(v => Number(v || 0) + MATCH_STAKE);
      await db.ref(`transactions/${uid}`).push(tx(uid, "Match stake refund", MATCH_STAKE, "VXB", "in", matchId));
    }
    if (secondReserved) {
      await db.ref(`users/${opponentUid}/coins/vxb`).transaction(v => Number(v || 0) + MATCH_STAKE);
      await db.ref(`transactions/${opponentUid}`).push(tx(opponentUid, "Match stake refund", MATCH_STAKE, "VXB", "in", matchId));
    }
    await matchRef.update({ status: "cancelled" });
    throw new HttpsError("failed-precondition", "A player no longer has enough VXB. Try again.");
  }
  await matchRef.update({ status: "active" });
  return { status: "matched", matchId };
});

exports.findMyMatch = onCall(async (request) => {
  const uid = requireAuth(request);
  const snap = await db.ref("matches").orderByChild("createdAt").limitToLast(30).get();
  const matches = snap.val() || {};
  const list = Object.values(matches).filter(m => m?.players?.[uid] === true && ["active", "settling", "completed"].includes(m.status)).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const live = list.find(m => ["active", "settling"].includes(m.status));
  return live ? { status: live.status, match: live } : { status: "waiting" };
});

exports.submitMultiplayerMove = onCall(async (request) => {
  const uid = requireAuth(request);
  const matchId = safeText(request.data?.matchId, 128);
  const move = String(request.data?.move || "");
  if (!matchId || !moves.includes(move)) throw new HttpsError("invalid-argument", "Invalid match or move.");
  const matchRef = db.ref(`matches/${matchId}`);
  const submitted = await matchRef.transaction(m => {
    if (!m || m.status !== "active" || m.players?.[uid] !== true || m.moves?.[uid]) return;
    m.moves = m.moves || {};
    m.moves[uid] = move;
    const playerIds = Object.keys(m.players || {});
    if (playerIds.length === 2 && playerIds.every(id => moves.includes(m.moves[id]))) {
      const [a,b] = playerIds, am=m.moves[a], bm=m.moves[b];
      const beats = x => x === "rock" ? "scissors" : x === "paper" ? "rock" : "paper";
      const winner = am === bm ? null : beats(am) === bm ? a : b;
      m.status = "settling";
      m.outcome = { winnerUid: winner, draw: winner === null, moves: { [a]: am, [b]: bm } };
    }
    return m;
  });
  if (!submitted.committed) {
    const current = (await matchRef.get()).val();
    if (current?.moves?.[uid]) return { status: current.status, match: current };
    throw new HttpsError("failed-precondition", "Match is not active or your move was already submitted.");
  }
  let match = submitted.snapshot.val();
  if (match.status === "settling") {
    const claim = await matchRef.child("payoutClaimed").transaction(v => v === true ? undefined : true);
    if (claim.committed) {
      const ids = Object.keys(match.players);
      const winnerUid = match.outcome?.winnerUid || null;
      if (winnerUid) {
        const loserUid = ids.find(id => id !== winnerUid);
        await db.ref(`users/${winnerUid}`).transaction(u => {
          if (!u?.coins) return;
          u.coins.vxb = Number(u.coins.vxb || 0) + MATCH_STAKE * 2;
          u.stats = u.stats || { games: 0, wins: 0, losses: 0, draws: 0, netVxb: 0, streak: 0 };
          u.stats.games = Number(u.stats.games || 0) + 1; u.stats.wins = Number(u.stats.wins || 0) + 1;
          u.stats.netVxb = Number(u.stats.netVxb || 0) + MATCH_STAKE;
          u.stats.streak = Number(u.stats.streak || 0) + 1; return u;
        });
        await db.ref(`users/${loserUid}`).transaction(u => {
          if (!u?.coins) return;
          u.stats = u.stats || { games: 0, wins: 0, losses: 0, draws: 0, netVxb: 0, streak: 0 };
          u.stats.games = Number(u.stats.games || 0) + 1; u.stats.losses = Number(u.stats.losses || 0) + 1;
          u.stats.netVxb = Number(u.stats.netVxb || 0) - MATCH_STAKE; u.stats.streak = 0; return u;
        });
        await db.ref(`transactions/${winnerUid}`).push(tx(winnerUid, "Online match victory", MATCH_STAKE * 2, "VXB", "in", matchId));
        await db.ref(`transactions/${loserUid}`).push(tx(loserUid, "Online match loss", MATCH_STAKE, "VXB", "out", matchId));
        match.payout = { [winnerUid]: MATCH_STAKE * 2, [loserUid]: -MATCH_STAKE };
      } else {
        for (const id of ids) {
          await db.ref(`users/${id}/coins/vxb`).transaction(v => Number(v || 0) + MATCH_STAKE);
          await db.ref(`users/${id}/stats`).transaction(s => { s=s||{games:0,wins:0,losses:0,draws:0,netVxb:0,streak:0};s.games=Number(s.games||0)+1;s.draws=Number(s.draws||0)+1;return s; });
          await db.ref(`transactions/${id}`).push(tx(id, "Online match draw refund", MATCH_STAKE, "VXB", "in", matchId));
        }
      }
      await matchRef.update({ status: "completed", completedAt: new Date().toISOString(), payout: match.payout || {} });
    }
  }
  const finalSnap = await matchRef.get();
  return { status: finalSnap.val()?.status || "active", match: finalSnap.val() };
});

exports.convertCoins = onCall(async (request) => {
  const uid = requireAuth(request);
  const from = String(request.data?.from || "");
  const to = String(request.data?.to || "");
  const amount = Number(request.data?.amount);
  const rates = {
    "gold:silver": 1000, "silver:gold": 0.001,
    "silver:bronze": 1000, "bronze:silver": 0.001,
    "silver:vxb": 2000, "vxb:silver": 1/2000
  };
  const rate = rates[`${from}:${to}`];
  if (!COINS.includes(from) || !COINS.includes(to) || from === to || rate === undefined || !Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) {
    throw new HttpsError("invalid-argument", "Invalid conversion.");
  }
  const output = amount * rate;
  if (!Number.isSafeInteger(output) || output < 1) throw new HttpsError("invalid-argument", "Amount is too small for an exact conversion.");
  const ref = db.ref(`users/${uid}`);
  const result = await ref.transaction(u => {
    if (!u?.coins || Number(u.coins[from] || 0) < amount) return;
    u.coins[from] = Number(u.coins[from] || 0) - amount;
    u.coins[to] = Number(u.coins[to] || 0) + output;
    u.updatedAt = new Date().toISOString();
    return u;
  });
  if (!result.committed) throw new HttpsError("failed-precondition", "Not enough coins or profile missing.");
  await db.ref(`transactions/${uid}`).push(tx(uid, `Conversion ${from.toUpperCase()} → ${to.toUpperCase()}`, amount, from.toUpperCase(), "out", `CONVERT-${output}-${to.toUpperCase()}`));
  await db.ref(`transactions/${uid}`).push(tx(uid, `Conversion received ${to.toUpperCase()}`, output, to.toUpperCase(), "in", `CONVERT-${amount}-${from.toUpperCase()}`));
  return { profile: result.snapshot.val(), from, to, amount, output };
});
