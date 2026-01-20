# TicketHelpLFC Credit Tracker (PWA)

This repo hosts a **single-file** PWA build of the TicketHelpLFC Credit Tracker.

## Files
- `index.html` – the entire app (HTML/CSS/JS + embedded fixtures)
- `manifest.json` – PWA manifest
- `sw.js` – service worker (offline support)
- `icon.svg` – app icon

## Live URL
https://tickethelplfc.github.io/CreditTracker/

## Update process (mobile-friendly)
1. Download the latest ZIP from ChatGPT
2. Unzip on your phone
3. Upload/overwrite these files in the repo root:
   - index.html
   - manifest.json
   - sw.js
   - icon.svg
   - README.md (optional)

## Install
- **Android:** Chrome → menu → Install app / Add to Home screen
- **iPhone:** Safari → Share → Add to Home Screen

## Cache note
After major updates, if you don’t see changes:
- Remove the installed app
- Clear site data for `tickethelplfc.github.io`
- Reopen and reinstall

## Account management
Use the **Edit** and **Delete** buttons under the Account selector to rename an account and set AutoCup toggles, or remove an account.
