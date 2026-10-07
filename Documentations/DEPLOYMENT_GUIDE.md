# SSG Office Assistant App - Deployment Guide

## 📦 Frontend Libraries Used

```json
{
  "UI Components & Styling": {
    "@mui/material": "^7.3.5",
    "@mui/icons-material": "^7.3.5",
    "@emotion/react": "^11.14.0",
    "@emotion/styled": "^11.14.1"
  },
  "Core React": {
    "react": "^19.2.0",
    "react-dom": "^19.1.1",
    "react-router-dom": "^7.9.3"
  },
  "Icons": {
    "lucide-react": "^0.547.0",
    "react-icons": "^5.6.0"
  },
  "Data Handling": {
    "firebase": "^12.4.0",
    "papaparse": "^5.5.3",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  },
  "Visualization": {
    "recharts": "^3.5.1"
  }
}
```

---

## 🚀 Deploy to GitHub Pages

### Quick Deploy

```bash
npm run deploy
```

This single command will:
1. ✅ Build the project for production
2. ✅ Create optimized bundles
3. ✅ Deploy to `gh-pages` branch
4. ✅ Make your app live at: https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/

---

## 📋 Step-by-Step Deployment

### 1. Commit Your Changes

```bash
git add .
git commit -m "Ready for deployment"
git push origin main
```

### 2. Build & Deploy

```bash
npm run deploy
```

### 3. Configure GitHub Pages

1. Go to: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/settings/pages
2. Under **Source**:
   - Branch: `gh-pages`
   - Folder: `/ (root)`
3. Click **Save**

### 4. Wait 2-3 Minutes

GitHub Pages takes a few minutes to build and deploy.

---

## 🔗 Share with Classmates

### Production URL
```
https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/
```

### Test Accounts (for demo)

You can create test accounts or provide credentials:

**Admin Account:**
```
Email: admin@ctu-dbn.edu
Password: [provide secure password]
Role: Administrator
```

**Regular User:**
```
Email: student@ctu-dbn.edu
Password: [provide secure password]
Role: Member
```

---

## 🔄 Auto-Deploy on Every Push

A GitHub Action has been configured (`.github/workflows/deploy.yml`) that will:

- ✅ Automatically deploy when you push to `main`
- ✅ Build the project
- ✅ Update GitHub Pages
- ✅ No manual deploy needed!

### To Use Auto-Deploy:

```bash
# Make changes to your code
git add .
git commit -m "Your changes"
git push origin main

# GitHub will automatically deploy!
# Check progress at: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/actions
```

---

## 🛠️ Manual Deploy Commands

### Build Only (Test Locally)
```bash
npm run build
npm run preview
```

### Force Rebuild & Deploy
```bash
rm -rf dist
npm run deploy
```

### Check Build Size
```bash
npm run build
Get-ChildItem -Path dist -Recurse | Measure-Object -Property Length -Sum
```

---

## ⚙️ Configuration Files

### vite.config.js
```javascript
export default defineConfig({
  plugins: [react()],
  base: '/Prototype-SSG-Office-Assistant-App/',  // Your repo name
  envPrefix: ['VITE_', 'TELEGRAM_'],
  build: {
    modulePreload: false,
  }
})
```

### package.json Scripts
```json
{
  "predeploy": "npm run build",
  "deploy": "gh-pages -d dist"
}
```

---

## 🔐 Environment Variables

For production deployment, ensure these are set in your Firebase project:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_FACULTY_CHAT_ID=your_chat_id
```

⚠️ **Note:** Never commit `.env.local` to GitHub!

---

## 📊 Deployment Checklist

Before sharing with classmates:

- [ ] All code committed to `main` branch
- [ ] `npm run build` succeeds without errors
- [ ] Firebase configuration is correct
- [ ] Test accounts created for demo
- [ ] GitHub Pages source set to `gh-pages` branch
- [ ] Site is accessible at production URL
- [ ] All features tested in production
- [ ] Documentation updated
- [ ] Survey links prepared (if needed)

---

## 🐛 Troubleshooting

### Blank Page After Deploy
**Problem:** Site shows blank page  
**Solution:** Check `base` in `vite.config.js` matches your repo name

### 404 on Refresh
**Problem:** Page not found when refreshing  
**Solution:** This is normal for SPAs on GitHub Pages. Use HashRouter or add 404.html redirect.

### Build Fails
**Problem:** `npm run build` errors  
**Solution:** 
```bash
rm -rf node_modules
rm package-lock.json
npm install
npm run build
```

### Deploy Fails
**Problem:** `gh-pages` publish error  
**Solution:**
```bash
npm install gh-pages --save-dev
npm run deploy
```

---

## 📱 Mobile Testing

Test on mobile devices:
1. Open production URL on phone
2. Test all features
3. Check responsive design
4. Verify Firebase authentication works

---

## 🎓 For Research/Demo

### Survey Distribution
```markdown
Dear Respondents,

Please access the SSG Office Assistant App at:
https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/

Login Credentials:
- Email: [provided]
- Password: [provided]

Please complete the survey after testing the system.

Thank you!
```

### Presentation Notes
- Live demo URL ready
- Backup video recording (in case of internet issues)
- Test accounts prepared
- Feature highlights documented
- Known issues documented

---

## 📞 Support

For deployment issues, contact:
- **Developer:** Elijah Glenn B. Tugad
- **Project Lead:** [Team Lead Name]
- **Repository:** https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App

---

**Last Updated:** October 7, 2026  
**Deployment Status:** ✅ Production Ready  
**Version:** 1.0.0
