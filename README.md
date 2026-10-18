# Hisab Khata (web)

Natural-language income/expense entry (Bangla, English, Banglish), Dues & Debts, Budget, Savings goals, Insights.
Sign in with email + password. Two profiles (Personal, Professional), each stored as its own Google Sheet and synced across devices.

## How it fits together
- The website (these files) is static: host it on GitHub Pages. It holds no personal data.
- Your data lives in Google Sheets in the Drive of the Google account that owns the script.
  Each app account gets two sheets: "Hisab Khata - <email> - Personal" and "... - Professional".
- `apps-script/Code.gs` is the small server in between. It stores a salted hash of each password (the browser
  only ever sends a PBKDF2 hash, never the plain password) and hands out a 90-day session token.

## Setup (once)
1. Use a normal @gmail.com Google account to own the script (a school/work account often blocks "Anyone" access).
2. https://script.google.com -> New project -> delete the sample code -> paste all of `apps-script/Code.gs`.
3. Change `SIGNUP_CODE` near the top to a private word only you know. Save.
4. Deploy -> New deployment -> Web app. Execute as: Me. Who has access: **Anyone**. Deploy, Authorize
   (Google warns "unverified app": Advanced -> Go to project). Copy the Web app URL (ends with /exec).
5. Open `config.js` and paste the URL between the quotes, then upload the website files to GitHub
   (Settings -> Pages -> Deploy from branch main / root). If you skip config.js, the login screen asks for the URL instead.
6. Open the website -> "New here? Create an account" -> email, password, and your SIGNUP_CODE. On your phone just Sign in.

## Daily use
- Changes sync a couple of seconds after saving, every 30 s, and when you return to the tab.
- Status dot beside the title: green = synced, yellow = syncing/offline, red = problem, grey = this device only.
- Offline edits are kept on the device and uploaded later.
- Settings: open your Google Sheets, Log out, Log out of all devices (if a phone is lost), Excel/CSV downloads.
- You can edit the Google Sheets by hand (keep tab names and header row; dates YYYY-MM-DD or DD/MM/YYYY).

## Troubleshooting
- "Could not reach the server": open the Web app URL in a private/incognito window. It must show `{"ok":true,...}`.
  If it asks you to sign in to Google, redeploy with Who has access = Anyone (Deploy -> Manage deployments -> pencil -> New version).
- After changing Code.gs always create a New version in Manage deployments, otherwise the old code keeps running.
- Wrong password 5 times locks that email for 15 minutes.
- Forgot your password: in the script editor set `EMAIL_TO_RESET` to your email, run the function `removeLogin`,
  then "Create account" again with the same email and a new password. Your data is kept.
- If you deleted the Google Sheets from Drive, run `resetSheets` once in the script editor.

## Notes
- Anyone who finds the server URL can only create an account if they know your SIGNUP_CODE, and can only read data after signing in.
  The owner of the Google account can see everyone's sheets in Drive; do not give accounts to people you do not trust.
- If two devices change the same row, the most recent edit wins. Different rows merge cleanly.
- Deleted rows stay in the sheet with Deleted = 1 for 90 days so other devices learn about the deletion.
- The parser is rule-based (keywords and number words such as "ponero hajar", "der lakh"). Edit the lists at the top of parser.js.
