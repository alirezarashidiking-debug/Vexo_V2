(() => {
  const $ = id => document.getElementById(id);
  let auth, db, functions, currentUser = null, profile = null, profileRef = null, txRef = null, mode = "register", gameMode = "bot", activeMatchId = null, matchRef = null, pollTimer = null;
  const money = n => Math.floor(Number(n || 0)).toLocaleString("en-US");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  function toast(message) { const t=$("toast"); t.textContent=message; t.classList.remove("hidden"); clearTimeout(window.__vexoToast); window.__vexoToast=setTimeout(()=>t.classList.add("hidden"),3600); }
  function setMode(next) {
    mode=next; const reg=next==="register";
    $("registerTab").classList.toggle("active",reg); $("loginTab").classList.toggle("active",!reg);
    $("nameWrap").classList.toggle("hidden",!reg); $("usernameWrap").classList.toggle("hidden",!reg); $("confirmWrap").classList.toggle("hidden",!reg);
    $("displayName").required=reg; $("username").required=reg; $("confirmPassword").required=reg;
    $("password").autocomplete=reg?"new-password":"current-password";
    $("authSubmit").textContent=reg?"Create account ↗":"Sign in ↗";
  }
  function showAuth(message) { $("authView").classList.remove("hidden"); $("appView").classList.add("hidden"); $("logout").classList.add("hidden"); if(message) toast(message); }
  function showApp() { $("authView").classList.add("hidden"); $("appView").classList.remove("hidden"); $("logout").classList.remove("hidden"); }
  function call(name,data={}) { return functions.httpsCallable(name)(data).then(r=>r.data); }
  function render(p) {
    profile=p; if(!p) return;
    const c=p.coins||{}, s=p.stats||{};
    $("helloName").textContent=p.displayName||"Player"; $("profileName").textContent=p.displayName||"Player";
    $("profileBio").textContent=p.bio||"New to VEXO"; $("userHandle").textContent="@"+(p.username||"player");
    $("avatar").textContent=(p.displayName||"V").slice(0,1).toUpperCase();
    $("memberSince").textContent="Member since "+new Date(p.createdAt||Date.now()).toLocaleDateString("en-US",{month:"short",year:"numeric"});
    ["gold","silver","bronze","vxb"].forEach(k=>$(k).textContent=money(c[k]));
    $("games").textContent=money(s.games); $("wins").textContent=money(s.wins);
    $("winRate").textContent=(s.games?Math.round((s.wins/s.games)*100):0)+"%";
    $("net").textContent=(Number(s.netVxb||0)>0?"+":"")+money(s.netVxb);
    $("editName").value=p.displayName||""; $("editBio").value=p.bio||"";
    const daily=p.daily||{}; $("dailyStatus").textContent=daily.day===new Date().toISOString().slice(0,10)&&daily.airdropDay===daily.day?"Already claimed today · reset at 00:00 UTC":"20–80 VXB · once per UTC day";
    $("airdrop").disabled=daily.day===new Date().toISOString().slice(0,10)&&daily.airdropDay===daily.day;
  }
  async function loadBoard() {
    try { const r=await call("getLeaderboard"); $("leaderboard").innerHTML=(r.users||[]).map((u,i)=>`<tr><td>${i+1}</td><td><b>${esc(u.displayName||u.username)}</b><br><span class="muted">@${esc(u.username)}</span></td><td>${money(u.coins?.vxb)}</td><td>${money(u.stats?.games)}</td><td>${money(u.stats?.wins)}</td></tr>`).join("")||'<tr><td colspan="5">No players yet.</td></tr>'; }
    catch(e) { $("leaderboard").innerHTML='<tr><td colspan="5">Leaderboard unavailable. Deploy Cloud Functions and check access.</td></tr>'; }
  }
  async function startSession(user) {
    currentUser=user;
    if(profileRef) profileRef.off(); if(txRef) txRef.off();
    if(!user) { profile=null; showAuth(); $("connection").textContent="Signed out"; return; }
    $("connection").textContent="Signed in";
    try {
      let snap=await db.ref("users/"+user.uid).once("value");
      if(!snap.exists()) {
        const pending=JSON.parse(sessionStorage.getItem("vexoPendingProfile")||"null");
        if(!pending) { await auth.signOut(); showAuth("Profile not initialized. Please create your account again."); return; }
        await call("initializeProfile",pending);
        sessionStorage.removeItem("vexoPendingProfile");
        snap=await db.ref("users/"+user.uid).once("value");
      }
      render(snap.val()); showApp(); if(gameMode==="online") pollForMatch();
      profileRef=db.ref("users/"+user.uid);
      profileRef.on("value",s=>{if(s.exists())render(s.val());},e=>toast("Profile sync error: "+e.message));
      txRef=db.ref("transactions/"+user.uid).limitToLast(8);
      await loadBoard();
    } catch(e) { showAuth("Could not load your VEXO profile: "+(e.message||e)); }
  }
  async function register(e) {
    e.preventDefault();
    const displayName=$("displayName").value.trim(), username=$("username").value.trim().toLowerCase(), email=$("email").value.trim().toLowerCase(), password=$("password").value, confirm=$("confirmPassword").value;
    if(!/^[a-z0-9_.-]{3,24}$/.test(username)) return toast("Username must be 3–24 letters, numbers, dots, dashes or underscores.");
    if(password.length<8) return toast("Use a password with at least 8 characters.");
    if(password!==confirm) return toast("Passwords do not match.");
    try {
      const availability = await call("checkUsername", { username });
      if (!availability.available) return toast("That username is already taken. Choose another one.");
      sessionStorage.setItem("vexoPendingProfile",JSON.stringify({username,displayName}));
      await auth.createUserWithEmailAndPassword(email,password);
      toast("Account created. Setting up your profile…");
    } catch(e) { toast(friendly(e)); }
  }
  async function login(e) {
    e.preventDefault();
    try { await auth.signInWithEmailAndPassword($("email").value.trim().toLowerCase(),$("password").value); }
    catch(e) { toast(friendly(e)); }
  }
  function friendly(e) {
    const code=e?.code||"";
    return ({
      "auth/email-already-in-use":"That email already has an account. Sign in instead.",
      "auth/invalid-email":"Enter a valid email address.",
      "auth/weak-password":"Choose a stronger password.",
      "auth/invalid-credential":"Email or password is incorrect.",
      "auth/too-many-requests":"Too many attempts. Wait a little and try again.",
      "functions/already-exists":"That username is already taken.",
      "functions/permission-denied":"Your account does not have permission for this action."
    })[code]||e.message||"Something went wrong. Please try again.";
  }
  async function play(move) {
    if(gameMode==="online") return submitOnlineMove(move);
    document.querySelectorAll("[data-move]").forEach(b=>b.disabled=true);
    $("gameResult").innerHTML='<span class="result-icon">⏳</span><b>Resolving round…</b><p>Waiting for trusted server result.</p>';
    try {
      const r=await call("playBot",{move});
      const delta=Number(r.delta||0), win=r.result==="win";
      const symbols={rock:"✊",paper:"✋",scissors:"✌️"};
      $("gameResult").innerHTML=`<span class="result-icon">${symbols[r.playerMove]} <span class="muted">vs</span> ${symbols[r.rivalMove]}</span><b>${r.result.toUpperCase()} · ${delta>0?"+":""}${money(delta)} VXB</b><p>${win?"Nice round.":r.result==="loss"?"Better luck next round.":"A draw costs 2 VXB."} Result verified by server.</p>`;
      render(r.profile); toast("Round complete: "+(delta>0?"+":"")+delta+" VXB.");
    } catch(e) { $("gameResult").innerHTML='<span class="result-icon">⚠️</span><b>Round not completed</b><p>'+esc(friendly(e))+'</p>'; toast(friendly(e)); }
    finally { document.querySelectorAll("[data-move]").forEach(b=>b.disabled=false); await loadBoard(); }
  }

  function setGameMode(next) {
    gameMode=next;
    $("botMode").classList.toggle("mode-active",next==="bot");
    $("onlineMode").classList.toggle("mode-active",next==="online");
    $("onlinePanel").classList.toggle("hidden",next!=="online");
    $("gameSub").textContent=next==="bot"?"Beat the bot to earn VXB. A loss costs VXB.":"Find a real online opponent. Both players stake 40 VXB; winner receives 80 VXB.";
    $("gameResult").innerHTML='<span class="result-icon">⚡</span><b>'+(next==="bot"?"Choose your move":"Find an opponent to start")+'</b><p>'+(next==="bot"?"Round is resolved by Firebase Cloud Functions.":"Online moves are matched and settled by Firebase Cloud Functions.")+'</p>';
    if(next==="online") pollForMatch();
    else if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  }
  async function findOnline() {
    $("findOnline").disabled=true;
    $("matchStatus").textContent="Joining secure matchmaking…";
    try {
      const r=await call("joinMultiplayer");
      if(r.status==="matched") {
        activeMatchId=r.matchId;
        $("matchStatus").textContent="Opponent found! Pick Rock, Paper or Scissors.";
        watchMatch(activeMatchId);
      } else {
        $("matchStatus").textContent="You are in the queue. Keep this page open while we find an opponent…";
        pollForMatch();
      }
    } catch(e) { $("matchStatus").textContent=friendly(e); toast(friendly(e)); }
    finally { $("findOnline").disabled=false; }
  }
  async function pollForMatch() {
    if(gameMode!=="online" || !currentUser || activeMatchId) return;
    try {
      const r=await call("findMyMatch");
      if(r.match && r.match.matchId) {
        activeMatchId=r.match.matchId;
        $("matchStatus").textContent=r.status==="active"?"Opponent found! Pick your move.":r.status==="completed"?"Match completed.":"Match is being settled…";
        watchMatch(activeMatchId);
        return;
      }
    } catch(e) {}
    if(!pollTimer) pollTimer=setInterval(async()=>{
      if(gameMode!=="online" || !currentUser || activeMatchId) {clearInterval(pollTimer);pollTimer=null;return;}
      try {
        const r=await call("findMyMatch");
        if(r.match && r.match.matchId) {
          activeMatchId=r.match.matchId;clearInterval(pollTimer);pollTimer=null;
          $("matchStatus").textContent=r.status==="active"?"Opponent found! Pick your move.":"Match status: "+r.status;
          watchMatch(activeMatchId);
        }
      } catch(e) {}
    },4000);
  }
  function watchMatch(matchId) {
    if(matchRef) matchRef.off();
    matchRef=db.ref("matches/"+matchId);
    matchRef.on("value",snap=>{
      const m=snap.val();if(!m)return;
      if(m.status==="active") {
        $("matchStatus").textContent=m.moves && m.moves[currentUser.uid]?"Move submitted. Waiting for opponent…":"Opponent connected. Pick your move.";
      } else if(m.status==="settling") $("matchStatus").textContent="Both moves received. Settling stakes…";
      else if(m.status==="completed") {
        const mine=m.outcome?.winnerUid;
        const draw=!!m.outcome?.draw;
        const myMove=m.outcome?.moves?.[currentUser.uid]||"";
        const otherUid=Object.keys(m.players||{}).find(id=>id!==currentUser.uid);
        const otherMove=m.outcome?.moves?.[otherUid]||"";
        const icons={rock:"✊",paper:"✋",scissors:"✌️"};
        const won=mine===currentUser.uid;
        $("gameResult").innerHTML=`<span class="result-icon">${icons[myMove]||"⚔️"} <span class="muted">vs</span> ${icons[otherMove]||"⚔️"}</span><b>${draw?"DRAW":won?"VICTORY":"DEFEAT"} · ${draw?"stake refunded":won?"+40 VXB net":"−40 VXB"}</b><p>Online match resolved by server. Find another opponent when ready.</p>`;
        $("matchStatus").textContent="Match complete. You can find another opponent.";
        activeMatchId=null;matchRef.off();matchRef=null;
        if(profileRef) profileRef.once("value").then(s=>{if(s.exists())render(s.val())});
        loadBoard();
      } else if(m.status==="cancelled") {
        $("matchStatus").textContent="Match cancelled; any reserved stake was refunded.";
        activeMatchId=null;
      }
    });
  }
  async function submitOnlineMove(move) {
    if(!activeMatchId) {toast("Find an online opponent first.");return;}
    document.querySelectorAll("[data-move]").forEach(b=>b.disabled=true);
    try {
      const r=await call("submitMultiplayerMove",{matchId:activeMatchId,move});
      $("matchStatus").textContent=r.status==="completed"?"Match complete.": "Move submitted. Waiting for opponent…";
      $("gameResult").innerHTML='<span class="result-icon">⏳</span><b>Move locked</b><p>Your move is submitted. Waiting for the other player.</p>';
    } catch(e) { toast(friendly(e)); }
    finally { document.querySelectorAll("[data-move]").forEach(b=>b.disabled=false); }
  }

  async function airdrop() {
    $("airdrop").disabled=true;
    try { const r=await call("claimAirdrop"); render(r.profile); toast("Daily airdrop: +"+money(r.reward)+" VXB"); }
    catch(e) { toast(friendly(e)); }
    finally { if(profile)render(profile); }
  }

  async function convertCoins(e) {
    e.preventDefault();
    const from=$("convertFrom").value,to=$("convertTo").value,amount=Number($("convertAmount").value);
    if(from===to) return toast("Choose two different coin types.");
    if(!Number.isSafeInteger(amount)||amount<1) return toast("Enter a positive whole number.");
    try {
      const r=await call("convertCoins",{from,to,amount});
      render(r.profile); $("convertAmount").value="";
      toast(`Converted ${money(r.amount)} ${from.toUpperCase()} into ${money(r.output)} ${to.toUpperCase()}.`);
    } catch(e) { toast(friendly(e)); }
  }
  function updateConversionHint() {
    const from=$("convertFrom").value,to=$("convertTo").value;
    const rates={"gold:silver":"1 Gold = 1,000 Silver","silver:gold":"1,000 Silver = 1 Gold","silver:bronze":"1 Silver = 1,000 Bronze","bronze:silver":"1,000 Bronze = 1 Silver","silver:vxb":"1 Silver = 2,000 VXB","vxb:silver":"2,000 VXB = 1 Silver"};
    $("conversionHint").textContent=rates[`${from}:${to}`]||"Only direct, exact conversions are supported. Convert through Silver for other coin pairs.";
  }

  async function saveProfile(e) {
    e.preventDefault();
    try { await call("updateProfile",{displayName:$("editName").value.trim(),bio:$("editBio").value.trim()}); toast("Profile saved."); }
    catch(e) { toast(friendly(e)); }
  }
  async function boot() {
    try {
      if(!window.VEXO_FIREBASE_CONFIG) throw new Error("Firebase config missing.");
      const app=firebase.apps.length?firebase.app():firebase.initializeApp(window.VEXO_FIREBASE_CONFIG);
      auth=firebase.auth(); db=firebase.database(); functions=firebase.app().functions("us-central1");
      db.ref(".info/connected").on("value",s=>{$("connection").textContent=s.val()?"Firebase connected":"Connecting…";});
      $("registerTab").onclick=()=>setMode("register"); $("loginTab").onclick=()=>setMode("login");
      $("authForm").onsubmit=e=>mode==="register"?register(e):login(e);
      $("logout").onclick=()=>auth.signOut();
      $("profileForm").onsubmit=saveProfile; $("convertForm").onsubmit=convertCoins;
      $("convertFrom").onchange=updateConversionHint; $("convertTo").onchange=updateConversionHint;
      $("airdrop").onclick=airdrop; $("refreshBoard").onclick=loadBoard; updateConversionHint();
      document.querySelectorAll("[data-move]").forEach(b=>b.onclick=()=>play(b.dataset.move));
      $("botMode").onclick=()=>setGameMode("bot"); $("onlineMode").onclick=()=>setGameMode("online"); $("findOnline").onclick=findOnline;
      setMode("register"); auth.onAuthStateChanged(startSession);
    } catch(e) { $("connection").textContent="Setup required"; showAuth("Firebase setup error: "+e.message); }
  }
  boot();
})();