(() => {
 const $=id=>document.getElementById(id); let auth,db,functions,users={};
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const money=n=>Math.floor(Number(n||0)).toLocaleString("en-US");
 function toast(m){const t=$("toast");t.textContent=m;t.classList.remove("hidden");clearTimeout(window.__adminToast);window.__adminToast=setTimeout(()=>t.classList.add("hidden"),3500)}
 function call(n,d={}){return functions.httpsCallable(n)(d).then(r=>r.data)}
 function msg(e){if(e.code==="functions/permission-denied")return "This Firebase account is not assigned admin permission.";if(e.code==="auth/invalid-credential")return "Email or password is incorrect.";return e.message||"Something went wrong."}
 async function load(){
  try{
   const [metrics,all]=await Promise.all([call("adminGetMetrics"),call("adminListUsers")]); users=all.users||{};
   $("metricUsers").textContent=money(metrics.totalUsers);$("metricVxb").textContent=money(metrics.totalVxb);$("metricGold").textContent=money(metrics.goldIssuedToday)+" / 100";
   const ids=Object.keys(users);$("targetUser").innerHTML='<option value="">Choose an account</option>'+ids.map(uid=>`<option value="${esc(uid)}">${esc(users[uid].displayName||users[uid].username)} · @${esc(users[uid].username)}</option>`).join("");
   $("userList").innerHTML=ids.length?ids.map(uid=>{const u=users[uid];return `<div class="user-item"><div><b>${esc(u.displayName||u.username)}</b><small>@${esc(u.username)} · ${esc(u.email||"no email")}</small></div><div style="text-align:right"><b>${money(u.coins?.vxb)} VXB</b><small>${money(u.coins?.gold)} Gold · UID ${esc(uid.slice(0,9))}…</small></div></div>`}).join(""):'<p class="muted small">No accounts yet.</p>';
   const audits=Object.values(metrics.audit||{}).reverse();$("auditList").innerHTML=audits.length?audits.map(a=>`<div class="user-item"><div><b>${esc(a.direction==="in"?"Grant":"Deduction")} ${money(a.amount)} ${esc(a.coin)}</b><small>Target ${esc(a.targetUid)} · Admin ${esc(a.adminUid)}</small></div><small>${esc(a.createdAt||"")}</small></div>`).join(""):'<p class="muted small">No admin activity yet.</p>';
  }catch(e){$("adminAuthStatus").textContent=msg(e);toast(msg(e));}
 }
 async function checkAdmin(user){
  if(!user){$("adminAuth").classList.remove("hidden");$("adminApp").classList.add("hidden");$("connection").textContent="Signed out";return;}
  $("connection").textContent="Signed in";
  try{
   const snap=await db.ref("admins/"+user.uid).once("value");
   if(snap.val()!==true){$("adminAuth").classList.remove("hidden");$("adminApp").classList.add("hidden");$("adminAuthStatus").textContent="Access denied. Assign this user's UID under /admins in the Firebase Console.";return;}
   $("adminAuth").classList.add("hidden");$("adminApp").classList.remove("hidden");$("adminAuthStatus").textContent="";await load();
  }catch(e){$("adminAuthStatus").textContent=msg(e);}
 }
 async function boot(){
  try{
   const app=firebase.apps.length?firebase.app():firebase.initializeApp(window.VEXO_FIREBASE_CONFIG);auth=firebase.auth();db=firebase.database();functions=app.functions("us-central1");
   db.ref(".info/connected").on("value",s=>$("connection").textContent=s.val()?"Firebase connected":"Connecting…");
   $("adminLogin").onsubmit=async e=>{e.preventDefault();try{await auth.signInWithEmailAndPassword($("adminEmail").value.trim(),$("adminPassword").value);}catch(err){$("adminAuthStatus").textContent=msg(err)}};
   $("adminLogout").onclick=()=>auth.signOut();$("refreshAdmin").onclick=load;
   $("adjustForm").onsubmit=async e=>{e.preventDefault();try{const result=await call("adminAdjustCoins",{uid:$("targetUser").value,coin:$("coinType").value,direction:$("direction").value,amount:Number($("amount").value)});toast("Adjustment applied securely.");$("amount").value="";await load();}catch(err){toast(msg(err))}};
   auth.onAuthStateChanged(checkAdmin);
  }catch(e){$("adminAuthStatus").textContent="Firebase setup error: "+e.message;}
 }
 boot();
})();