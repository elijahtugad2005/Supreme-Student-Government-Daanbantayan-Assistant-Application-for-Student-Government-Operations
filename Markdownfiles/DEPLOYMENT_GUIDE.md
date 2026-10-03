# GitHub Pages Deployment Guide

## Overview
This guide will help you deploy the Shirio SSG Office Assistant App to GitHub Pages.

---

## Prerequisites

✅ **Already Configured**:
- `gh-pages` package installed
- `homepage` field in package.json
- `base` path in vite.config.js
- Deployment scripts in package.json

---

## Quick Deployment Steps

### 1. Ensure Git Repository is Set Up

```bash
# Check if git is initialized
git status

# If not initialized, run:
git init
git add .
git commit -m "Initial commit"
```

### 2. Connect to GitHub Repository

```bash
# Add remote repository (if not already added)
git remote add origin https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App.git

# Verify remote
git remote -v
```

### 3. Push to GitHub

```bash
# Push to main branch
git push -u origin main

# Or if using master branch
git push -u origin master
```

### 4. Deploy to GitHub Pages

```bash
# This will build and deploy automatically
npm run deploy
```

**What happens**:
1. `predeploy` script runs: `npm run build` (creates `dist` folder)
2. `deploy` script runs: `gh-pages -d dist` (deploys to gh-pages branch)

---

## Deployment Process Explained

### Step-by-Step Breakdown

```
┌─────────────────────────────────────────────────────────┐
│ 1. npm run deploy                                       │
│    ↓                                                    │
│ 2. predeploy: npm run build                            │
│    ↓                                                    │
│ 3. vite build (creates dist folder)                    │
│    ↓                                                    │
│ 4. gh-pages -d dist                                    │
│    ↓                                                    │
│ 5. Creates/updates gh-pages branch                     │
│    ↓                                                    │
│ 6. Pushes to GitHub                                    │
│    ↓                                                    │
│ 7. GitHub Pages serves the site                        │
└─────────────────────────────────────────────────────────┘
```

---

## Configuration Details

### package.json

```json
{
  "name": "shirio.json",
  "homepage": "https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App",
  "scripts": {
    "predeploy": "npm run build",
    "deploy": "gh-pages -d dist"
  }
}
```

**Key Fields**:
- `homepage`: Your GitHub Pages URL
- `predeploy`: Builds the project before deployment
- `deploy`: Deploys the `dist` folder to gh-pages branch

### vite.config.js

```javascript
export default defineConfig({
  plugins: [react()],
  base: '/Prototype-SSG-Office-Assistant-App/',
})
```

**Key Field**:
- `base`: Must match your repository name for correct asset paths

---

## GitHub Repository Settings

### Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** tab
3. Scroll to **Pages** section (left sidebar)
4. Under **Source**, select:
   - Branch: `gh-pages`
   - Folder: `/ (root)`
5. Click **Save**

### Visual Guide

```
GitHub Repository
├── Settings
│   └── Pages
│       ├── Source
│       │   ├── Branch: gh-pages ✓
│       │   └── Folder: / (root) ✓
│       └── Save
```

---

## Deployment Commands

### Full Deployment

```bash
# Build and deploy in one command
npm run deploy
```

### Manual Deployment (if needed)

```bash
# Step 1: Build the project
npm run build

# Step 2: Deploy manually
npx gh-pages -d dist
```

### Preview Build Locally

```bash
# Build the project
npm run build

# Preview the production build
npm run preview
```

---

## Troubleshooting

### Issue 1: "gh-pages not found"

**Solution**:
```bash
npm install gh-pages --save-dev
```

### Issue 2: "Permission denied"

**Solution**:
```bash
# Set up SSH key or use HTTPS with token
git remote set-url origin https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App.git
```

### Issue 3: "404 Page Not Found"

**Possible Causes**:
1. GitHub Pages not enabled in repository settings
2. Wrong branch selected (should be `gh-pages`)
3. Base path mismatch in vite.config.js

**Solution**:
```javascript
// vite.config.js - ensure base matches repo name
base: '/Prototype-SSG-Office-Assistant-App/',
```

### Issue 4: "Assets not loading (404 errors)"

**Solution**:
```javascript
// vite.config.js - check base path
base: '/Prototype-SSG-Office-Assistant-App/', // Must start and end with /
```

### Issue 5: "Blank page after deployment"

**Possible Causes**:
1. Router base path not configured
2. Firebase configuration issues
3. Console errors (check browser DevTools)

**Solution for Router**:
```javascript
// src/App.jsx or main.jsx
import { BrowserRouter } from 'react-router-dom';

<BrowserRouter basename="/Prototype-SSG-Office-Assistant-App">
  <App />
</BrowserRouter>
```

### Issue 6: "Firebase not working on GitHub Pages"

**Note**: Firebase should work fine on GitHub Pages, but ensure:
1. Firebase config is correct
2. Domain is authorized in Firebase Console
3. Check Firebase Console → Authentication → Settings → Authorized domains

**Add GitHub Pages domain**:
```
elijahtugad2005.github.io
```

---

## Updating Deployment

### After Making Changes

```bash
# 1. Commit your changes
git add .
git commit -m "Update: description of changes"

# 2. Push to GitHub
git push origin main

# 3. Deploy to GitHub Pages
npm run deploy
```

### Quick Update Script

```bash
# One-liner for commit, push, and deploy
git add . && git commit -m "Update" && git push && npm run deploy
```

---

## Deployment Checklist

Before deploying, ensure:

- [ ] All changes committed to git
- [ ] Firebase configuration is correct
- [ ] Environment variables are set (if any)
- [ ] Build succeeds locally (`npm run build`)
- [ ] Preview works locally (`npm run preview`)
- [ ] No console errors in browser
- [ ] All routes work correctly
- [ ] Images and assets load properly
- [ ] GitHub repository exists
- [ ] Git remote is configured
- [ ] GitHub Pages is enabled in settings

---

## Post-Deployment Verification

### 1. Check Deployment Status

Visit: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/deployments

### 2. Visit Your Site

URL: https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App

### 3. Test Functionality

- [ ] Homepage loads
- [ ] Navigation works
- [ ] Products display
- [ ] Order form works
- [ ] Firebase connection works
- [ ] Images load correctly
- [ ] Responsive design works
- [ ] All routes accessible

---

## GitHub Pages URL Structure

```
https://[username].github.io/[repository-name]/

Your URL:
https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/
```

---

## Deployment Timeline

```
┌─────────────────────────────────────────────────────────┐
│ npm run deploy                                          │
│ ├─ Build: ~20 seconds                                  │
│ ├─ Upload: ~10 seconds                                 │
│ └─ GitHub Pages processing: 1-5 minutes                │
│                                                         │
│ Total time: ~2-6 minutes                               │
└─────────────────────────────────────────────────────────┘
```

---

## Custom Domain (Optional)

### If you want to use a custom domain:

1. **Add CNAME file** in `public` folder:
   ```
   yourdomain.com
   ```

2. **Update package.json**:
   ```json
   "homepage": "https://yourdomain.com"
   ```

3. **Update vite.config.js**:
   ```javascript
   base: '/'
   ```

4. **Configure DNS** (in your domain registrar):
   ```
   Type: CNAME
   Name: www
   Value: elijahtugad2005.github.io
   ```

5. **Enable in GitHub Settings**:
   - Settings → Pages → Custom domain
   - Enter your domain
   - Check "Enforce HTTPS"

---

## Continuous Deployment (Optional)

### GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Build
      run: npm run build
      
    - name: Deploy
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./dist
```

**Benefits**:
- Automatic deployment on every push to main
- No need to run `npm run deploy` manually

---

## Environment Variables

### If you have sensitive data:

**DO NOT** commit `.env` files to GitHub!

**For GitHub Pages**:
1. Use GitHub Secrets (for GitHub Actions)
2. Or hardcode non-sensitive config
3. Or use Firebase Remote Config

**Note**: GitHub Pages is static hosting, so environment variables must be embedded at build time.

---

## Monitoring Deployment

### Check Build Status

```bash
# View recent deployments
git log --oneline gh-pages

# View gh-pages branch
git checkout gh-pages
git log
git checkout main
```

### GitHub Actions (if using)

- Go to repository → Actions tab
- View workflow runs
- Check logs for errors

---

## Rollback Deployment

### If something goes wrong:

```bash
# 1. Checkout gh-pages branch
git checkout gh-pages

# 2. Reset to previous commit
git reset --hard HEAD~1

# 3. Force push
git push origin gh-pages --force

# 4. Return to main branch
git checkout main
```

---

## Best Practices

### Before Deployment

1. ✅ Test locally with `npm run preview`
2. ✅ Check console for errors
3. ✅ Verify all routes work
4. ✅ Test on different browsers
5. ✅ Check mobile responsiveness

### After Deployment

1. ✅ Clear browser cache
2. ✅ Test in incognito mode
3. ✅ Verify Firebase connection
4. ✅ Check all features work
5. ✅ Monitor for errors

### Regular Maintenance

1. 🔄 Keep dependencies updated
2. 🔄 Monitor Firebase usage
3. 🔄 Check for broken links
4. 🔄 Review analytics (if enabled)
5. 🔄 Backup Firebase data regularly

---

## Quick Reference Commands

```bash
# Deploy to GitHub Pages
npm run deploy

# Build only
npm run build

# Preview build locally
npm run preview

# Check git status
git status

# Commit changes
git add .
git commit -m "Your message"

# Push to GitHub
git push origin main

# Full update cycle
git add . && git commit -m "Update" && git push && npm run deploy
```

---

## Support Resources

### Documentation
- [GitHub Pages Docs](https://docs.github.com/en/pages)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [gh-pages Package](https://github.com/tschaub/gh-pages)

### Common Issues
- [Vite + GitHub Pages](https://vitejs.dev/guide/static-deploy.html#github-pages)
- [React Router + GitHub Pages](https://create-react-app.dev/docs/deployment/#github-pages)

---

## Summary

Your project is **already configured** for GitHub Pages deployment! 

**To deploy**:
```bash
npm run deploy
```

**Your site will be live at**:
https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/

**Deployment takes**: ~2-6 minutes

**After deployment**:
- Clear browser cache
- Test all features
- Verify Firebase connection
- Check console for errors

---

## Next Steps

1. ✅ Run `npm run deploy`
2. ✅ Wait 2-6 minutes for GitHub Pages to process
3. ✅ Visit your site URL
4. ✅ Test all functionality
5. ✅ Share your live site!

**Your live URL**:
🌐 https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/

Good luck with your deployment! 🚀
