VEXO PRO MAX — MULTI-FILE + FIREBASE AUTH

DEPLOY TO GITHUB PAGES
1) Extract this ZIP.
2) Upload the CONTENTS of VEXO-PRO-MAX into the ROOT of your GitHub repository.
   Keep index.html beside the css/, js/, and assets/ folders.
3) Commit changes and wait for GitHub Pages to publish.
4) In Firebase Console > Authentication > Settings > Authorized domains, add:
   alirezarashidiking-debug.github.io
5) In Firebase Authentication > Sign-in method, enable Email/Password and Google.
6) In Realtime Database > Rules, publish the profile-only rules supplied separately in setup notes / prior chat.

FIREBASE CONNECTION
- Firebase Web SDK 12.5.0 is initialized in index.html.
- Email/password registration and login are connected.
- Google popup sign-in is connected.
- User profile displayName/email/UID is saved under /profiles/{uid}.
- Passwords are handled by Firebase Authentication and are never written to Realtime Database.

IMPORTANT LIMITATIONS — PLEASE READ
This package connects authentication and player profile only. Game rounds, multiplayer, missions/rewards, wallet balances, purchases/payments, daily earning limits, and GOD/admin permissions remain demo/UI features. They are NOT live or secure financial/game systems. Do not distribute real coins or accept payments until these features are implemented with trusted server-side code (for example Firebase Cloud Functions) and tested. Do not grant admin access using a client-side secret code.

All website interface text is English.
