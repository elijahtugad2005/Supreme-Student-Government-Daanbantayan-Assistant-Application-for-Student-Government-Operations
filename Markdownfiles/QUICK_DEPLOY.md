# Quick Deploy Guide

## 🚀 Deploy in 3 Steps

### Option 1: Simple Command (Recommended)

```bash
npm run deploy
```

That's it! Your site will be live in 2-6 minutes.

---

### Option 2: Full Update (Commit + Deploy)

```bash
# 1. Commit your changes
git add .
git commit -m "Your update message"

# 2. Push to GitHub
git push origin main

# 3. Deploy to GitHub Pages
npm run deploy
```

---

### Option 3: Use Deployment Script (Linux/Mac)

```bash
# Make script executable (first time only)
chmod +x deploy.sh

# Run deployment script
./deploy.sh
```

---

## ✅ Your Configuration

**Already set up**:
- ✅ `gh-pages` package installed
- ✅ Homepage URL configured
- ✅ Vite base path configured
- ✅ HashRouter (perfect for GitHub Pages)
- ✅ Deployment scripts ready

**Your live URL**:
```
https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/
```

---

## 🔧 First Time Setup

### 1. Ensure Git is Connected

```bash
# Check remote
git remote -v

# If not set, add remote
git remote add origin https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App.git
```

### 2. Enable GitHub Pages

1. Go to: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/settings/pages
2. Under **Source**, select:
   - Branch: `gh-pages`
   - Folder: `/ (root)`
3. Click **Save**

---

## 🧪 Test Before Deploy

```bash
# Build locally
npm run build

# Preview the build
npm run preview
```

Visit: http://localhost:4173

---

## 🐛 Troubleshooting

### Issue: "gh-pages not found"
```bash
npm install gh-pages --save-dev
```

### Issue: "Permission denied"
```bash
# Use HTTPS with token or set up SSH key
git remote set-url origin https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App.git
```

### Issue: "404 Page Not Found"
1. Check GitHub Pages settings (branch should be `gh-pages`)
2. Wait 2-6 minutes after deployment
3. Clear browser cache

### Issue: Blank page
- Check browser console for errors
- Verify Firebase configuration
- Ensure all routes use HashRouter (already configured ✅)

---

## 📱 After Deployment

### Verify Your Site

1. **Wait 2-6 minutes** for GitHub Pages to process
2. **Clear browser cache** (Ctrl+Shift+Delete)
3. **Visit your site**: https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/
4. **Test features**:
   - [ ] Homepage loads
   - [ ] Navigation works
   - [ ] Products display
   - [ ] Order form works
   - [ ] Firebase connection works
   - [ ] Hero text animation works
   - [ ] All routes accessible

---

## 🔄 Update Workflow

Every time you make changes:

```bash
# Quick update
npm run deploy

# Or full workflow
git add .
git commit -m "Update: description"
git push
npm run deploy
```

---

## 📊 Monitor Deployment

### Check Status
- Deployments: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/deployments
- Actions: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/actions

### View gh-pages Branch
```bash
git checkout gh-pages
git log
git checkout main
```

---

## 🎯 Important Notes

### HashRouter vs BrowserRouter

You're using **HashRouter** ✅ which is perfect for GitHub Pages because:
- No server configuration needed
- URLs work with `#` (e.g., `/#/order`)
- No 404 errors on direct navigation
- Simpler deployment

### Firebase on GitHub Pages

Firebase works perfectly on GitHub Pages! Just ensure:
1. ✅ Firebase config is correct (already set up)
2. ✅ Domain authorized in Firebase Console
3. Add to Firebase Console → Authentication → Authorized domains:
   ```
   elijahtugad2005.github.io
   ```

---

## 🚀 Ready to Deploy?

Run this command:

```bash
npm run deploy
```

Then visit (after 2-6 minutes):
```
https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/
```

---

## 📚 Full Documentation

For detailed information, see: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

## ✨ Success!

Once deployed, your SSG Office Assistant will be live and accessible to everyone!

**Share your site**:
- 🌐 https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/
- 📱 Works on mobile, tablet, and desktop
- 🔥 Connected to Firebase
- 🎨 Beautiful UI with theme system
- 🛒 Full e-commerce functionality

Happy deploying! 🎉
