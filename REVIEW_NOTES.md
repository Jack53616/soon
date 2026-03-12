# Review Notes

## Files to modify:

### 1. Withdrawal fee display + 3% per $100 extra
- `server/controllers/wallet.controller.js` - Add 3% per $100 extra fee, add fee preview endpoint for users
- `client/app.js` - Show fee breakdown when user enters withdrawal amount (showWithdrawConfirm)
- Add new API endpoint for user-facing fee preview

### 2. Design fixes
- `client/index.html` line 152 - Badge shows "👤 Member" - need to fix for Arabic
- `client/app.js` - hydrateUser function line 962-979 - rank display logic
- Badge position overlaps with balance - need to move icon up

### 3. Translations
- `client/app.js` i18n object - add missing keys for all 4 languages (en, ar, tr, de)
- `server/bot/bot.js` - getRankLabel function - add translations for all languages
- Rank labels need to be language-aware in frontend

### 4. Fake notifications improvement
- `client/app.js` lines 1256-1304 - startFeed function - improve visual design

### 5. Remove flag/country features
- `client/index.html` lines 430-447 - Country section in settings
- `client/app.js` lines 1825-1932 - Country picker code
- `client/style.css` - related styles

### 6. Maintenance mode - hide IDs
- `client/index.html` - maintenance screen
- `server/controllers/auth.controller.js` - getUserInfo - hide tg_id during maintenance
- `client/app.js` - hide ID in settings during maintenance
