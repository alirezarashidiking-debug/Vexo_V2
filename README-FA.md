# VEXO Firebase + GitHub Pages (production-oriented starter)

This package replaces the old localStorage-only account and coin demo with:
- Firebase Authentication (email/password)
- Realtime Database profile and wallet storage
- Callable Cloud Functions for bot rounds, daily airdrops, online PvP matchmaking, and admin coin adjustments
- Realtime Database security rules that deny client writes to balances
- Admin permissions based on an allowlisted Firebase UID (no admin password/code embedded in public JavaScript)
- 100 Gold/day global admin issuance cap enforced server-side

## Important before launch

This is source code prepared for your Firebase project, but it is **not deployed to your account yet**. You must deploy Cloud Functions and database rules from a computer logged in to your Google account. GitHub Pages cannot run server-side functions itself.

Cloud Functions deployment requires the Firebase CLI and a Firebase project on the **Blaze (pay-as-you-go)** plan. Set a budget alert in Google Cloud Billing before enabling billing. The app does not connect to a blockchain and its VXB are in-game credits, not real crypto or cash.

## 1. Enable Firebase Authentication

1. Open Firebase Console → project `vexo-v2`.
2. Authentication → Sign-in method → enable **Email/Password**.
3. Authentication → Settings → Authorized domains → add the hostname from your GitHub Pages URL, e.g. `YOUR-GITHUB-USERNAME.github.io` (hostname only; no `https://` or path).

## 2. Confirm the Realtime Database URL

This package uses:
`https://vexo-v2-default-rtdb.firebaseio.com`

Open Realtime Database → Data and check the URL shown at the top. If it differs, replace the URL in both `firebase-config.js` and `functions/index.js`.

## 3. Deploy the backend and secure database rules

Install Node.js LTS from https://nodejs.org/ and then open Terminal / PowerShell in this project folder.

Install the Firebase CLI:
```bash
npm install -g firebase-tools
```

Log in and deploy:
```bash
firebase login
firebase use vexo-v2
firebase deploy --only database,functions
```

If the CLI asks to enable APIs or link billing, review the prompts carefully. Cloud Functions generally requires Blaze billing. Do not deploy without understanding possible usage charges.

## 4. Publish the frontend with GitHub Pages

Upload **all files and folders inside this package** to the root of your GitHub repository (not the ZIP itself). `index.html` must be at the repository root.

In GitHub: repository → Settings → Pages → Build and deployment:
- Source: Deploy from a branch
- Branch: `main`
- Folder: `/(root)`
- Save

Wait for GitHub to publish the site, then open the generated URL. If the page is blank, check browser DevTools Console for Firebase config / authorized-domain errors.

## 5. Make your account the administrator (no public admin code)

This is intentionally not done with a shared secret written in JavaScript. Any “secret admin code” inside a public website can be copied by everyone.

1. Open your published VEXO site and create your own account with the email you control.
2. Firebase Console → Authentication → Users → find that email and copy its **UID**.
3. Firebase Console → Realtime Database → Data → create:
   - key: `admins`
   - child key: `PASTE_YOUR_UID_HERE`
   - value: boolean `true` (not the text string `"true"`)
4. Open `admin.html` on your GitHub Pages site and sign in using the same Firebase email/password. No admin password or code is stored in the public files.

Only do this for an account you control. Do not set `/admins` for public users. The database rules deny client writes to `/admins`; set the first admin manually through the Firebase Console.

## 6. Verify before public release

- Create two test accounts using two different email addresses.
- Confirm each user only sees their own profile.
- Test bot wins/losses and verify balances update after refreshing the page.
- Open the site in two different browsers and test online matchmaking. Each player needs at least 40 VXB for an online match.
- Test admin grants and confirm that grants over the global 100 Gold/day limit fail.
- Verify that ordinary users cannot write to `/users`, `/transactions`, `/admins`, or `/system` directly in the Realtime Database console/API.
- Check Firebase Authentication and Cloud Functions logs for errors.
- Add Firebase App Check and set budget alerts before promoting a public release.

## Economy / behavior

- New account starts with 250 Silver, 500 Bronze and 100 VXB.
- Bot: win +25 VXB, loss −8 VXB, draw −2 VXB.
- Daily airdrop: random 20–80 VXB once per UTC day; daily earned VXB cap is 1,000.
- Online PvP: each player stakes 40 VXB; winner receives 80 VXB (net +40), loser loses 40 VXB (net −40), draw refunds each 40 VXB.
- Conversions: 1 Gold = 1,000 Silver; 1 Silver = 1,000 Bronze; 1 Silver = 2,000 VXB. Exact direct conversions are server-validated.
- Admin can grant/deduct Gold, Silver, Bronze, or VXB. Total Gold grants are limited to 100 per UTC day.

## Security notes

- Firebase web config / `apiKey` is public by design. Never commit a service-account JSON, private key, or other server credential.
- Client-side code cannot grant itself admin rights; server functions check `/admins/{uid}`.
- Database rules deny browser writes to wallet/profile paths; trusted Cloud Functions perform balance changes.
- Review the rules and functions before handling anything of monetary value. This starter has no blockchain, fiat payments, or real cryptocurrency custody.
