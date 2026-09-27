# Step-by-Step GitHub Pages Deployment

## 🎯 Complete Deployment Process

Follow these steps **exactly** to deploy your project to GitHub Pages.

---

## Step 1: Commit All Your Changes

### 1.1 Check what needs to be committed

```bash
git status
```

### 1.2 Add all changes to staging

```bash
git add .
```

This adds:
- All modified files
- All new files
- All deleted files

### 1.3 Commit with a message

```bash
git commit -m "Add deployment configuration and hero text animation"
```

Or use a custom message:
```bash
git commit -m "Your custom message here"
```

---

## Step 2: Push to GitHub (Main Branch)

### 2.1 Check your remote repository

```bash
git remote -v
```

You should see:
```
origin  https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App.git (fetch)
origin  https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App.git (push)
```

### 2.2 Push to GitHub

```bash
git push origin main
```

Or if you're using master branch:
```bash
git push origin master
```

**Note**: This pushes to your **main** branch, NOT gh-pages yet.

---

## Step 3: Deploy to GitHub Pages

### 3.1 Run the deploy command

```bash
npm run deploy
```

### 3.2 What happens automatically:

```
┌─────────────────────────────────────────────────────────┐
│ 1. npm run deploy                                       │
│    ↓                                                    │
│ 2. predeploy: npm run build                            │
│    ↓                                                    │
│ 3. Vite builds your project → creates dist folder      │
│    ↓                                                    │
│ 4. gh-pages -d dist                                    │
│    ↓                                                    │
│ 5. Creates/updates gh-pages branch                     │
│    ↓                                                    │
│ 6. Pushes dist folder to gh-pages branch              │
│    ↓                                                    │
│ 7. GitHub Pages automatically deploys                  │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Expected output:

```
> shirio.json@0.0.0 predeploy
> npm run build

> shirio.json@0.0.0 build
> vite build

✓ built in 20.48s

> shirio.json@0.0.0 deploy
> gh-pages -d dist

Published
```

---

## Step 4: Enable GitHub Pages (First Time Only)

### 4.1 Go to your repository settings

Visit: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/settings/pages

### 4.2 Configure GitHub Pages

1. Under **"Build and deployment"**
2. Under **"Source"**, select:
   - **Branch**: `gh-pages` (from dropdown)
   - **Folder**: `/ (root)` (from dropdown)
3. Click **"Save"**

### 4.3 Visual guide:

```
GitHub Repository Settings
├── Pages (left sidebar)
│   └── Build and deployment
│       ├── Source
│       │   ├── Deploy from a branch ✓
│       │   └── Branch
│       │       ├── Select: gh-pages ✓
│       │       └── Select: / (root) ✓
│       └── [Save] ← Click this
```

---

## Step 5: Wait for Deployment

### 5.1 Deployment time: 2-6 minutes

GitHub Pages needs time to:
1. Detect the gh-pages branch update
2. Build the site
3. Deploy to their servers
4. Propagate to CDN

### 5.2 Check deployment status

Visit: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/deployments

You'll see:
- 🟡 **In progress** (yellow dot)
- 🟢 **Success** (green dot) - Site is live!
- 🔴 **Failed** (red dot) - Check logs

---

## Step 6: Visit Your Live Site

### 6.1 Your URL:

```
https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/
```

### 6.2 If you see 404:

1. **Wait 5 more minutes** - GitHub Pages can be slow
2. **Clear browser cache**: Ctrl + Shift + Delete
3. **Try incognito mode**: Ctrl + Shift + N
4. **Check deployment status** (Step 5.2)

---

## 🔄 Complete Command Sequence

Here's the **complete sequence** to run:

```bash
# 1. Add all changes
git add .

# 2. Commit changes
git commit -m "Deploy to GitHub Pages"

# 3. Push to GitHub main branch
git push origin main

# 4. Deploy to GitHub Pages
npm run deploy
```

---

## 📋 Copy-Paste Commands

### For Windows PowerShell:

```powershell
# Navigate to your project (if not already there)
cd "C:\Users\User\Desktop\REACT PROJECTS\React js BootCamp\Shirio"

# Add all changes
git add .

# Commit
git commit -m "Deploy to GitHub Pages with hero animation"

# Push to main
git push origin main

# Deploy to gh-pages
npm run deploy
```

### For Git Bash (Windows):

```bash
# Navigate to your project
cd "/c/Users/User/Desktop/REACT PROJECTS/React js BootCamp/Shirio"

# Add all changes
git add .

# Commit
git commit -m "Deploy to GitHub Pages with hero animation"

# Push to main
git push origin main

# Deploy to gh-pages
npm run deploy
```

---

## 🎯 What Each Command Does

### `git add .`
- Stages all changes (modified, new, deleted files)
- Prepares files for commit
- Does NOT upload anything yet

### `git commit -m "message"`
- Saves staged changes to local repository
- Creates a commit with your message
- Still local - not on GitHub yet

### `git push origin main`
- Uploads commits to GitHub
- Updates your **main** branch on GitHub
- Makes your code visible on GitHub

### `npm run deploy`
- Builds your project (`npm run build`)
- Creates `dist` folder with production files
- Creates/updates **gh-pages** branch
- Pushes `dist` folder to gh-pages branch
- Triggers GitHub Pages deployment

---

## 🔍 Verify Each Step

### After `git add .`:
```bash
git status
```
Should show: "Changes to be committed" (green text)

### After `git commit`:
```bash
git log --oneline -1
```
Should show your commit message

### After `git push`:
Visit: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App
Should see your latest commit

### After `npm run deploy`:
```bash
git branch -a
```
Should show: `remotes/origin/gh-pages`

---

## 🐛 Troubleshooting

### Error: "fatal: not a git repository"

**Solution**:
```bash
git init
git remote add origin https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App.git
```

### Error: "Permission denied"

**Solution**: Set up authentication
```bash
# Option 1: Use HTTPS with token
git remote set-url origin https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App.git

# Option 2: Use SSH (if you have SSH key set up)
git remote set-url origin git@github.com:elijahtugad2005/Prototype-SSG-Office-Assistant-App.git
```

### Error: "gh-pages not found"

**Solution**:
```bash
npm install gh-pages --save-dev
```

### Error: "Failed to get remote.origin.url"

**Solution**:
```bash
git remote add origin https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App.git
```

### Build fails

**Solution**:
```bash
# Test build locally first
npm run build

# If it fails, fix errors, then try again
npm run deploy
```

---

## ✅ Success Indicators

### You'll know it worked when:

1. ✅ `npm run deploy` completes without errors
2. ✅ You see "Published" message
3. ✅ GitHub shows gh-pages branch exists
4. ✅ Deployments page shows green checkmark
5. ✅ Your site loads at the URL

---

## 📊 Check Deployment Status

### Method 1: GitHub Deployments Page
Visit: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/deployments

### Method 2: GitHub Pages Settings
Visit: https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/settings/pages

Should show:
```
✅ Your site is live at https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/
```

### Method 3: Command Line
```bash
# Check if gh-pages branch exists
git ls-remote --heads origin gh-pages

# Should output:
# [commit-hash]    refs/heads/gh-pages
```

---

## 🎉 After Successful Deployment

### Test Your Site

Visit: https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/

Check:
- [ ] Homepage loads
- [ ] Hero text animation works
- [ ] Navigation works
- [ ] Products display
- [ ] Order form works
- [ ] Firebase connection works
- [ ] Mobile responsive
- [ ] No console errors

### Share Your Site

Your live URL:
```
https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/
```

---

## 🔄 Future Updates

Every time you make changes:

```bash
# 1. Add changes
git add .

# 2. Commit
git commit -m "Update: description of changes"

# 3. Push to main
git push origin main

# 4. Deploy to gh-pages
npm run deploy
```

Or use the one-liner:
```bash
git add . && git commit -m "Update" && git push && npm run deploy
```

---

## 📝 Quick Reference

### Essential Commands

```bash
# Check status
git status

# Add all changes
git add .

# Commit
git commit -m "message"

# Push to GitHub
git push origin main

# Deploy to GitHub Pages
npm run deploy

# Check branches
git branch -a

# View remote
git remote -v
```

---

## 🎯 Summary

**To deploy to GitHub Pages**:

1. **Commit your code** → `git add .` + `git commit`
2. **Push to GitHub** → `git push origin main`
3. **Deploy** → `npm run deploy`
4. **Wait 2-6 minutes**
5. **Visit your site** → https://elijahtugad2005.github.io/Prototype-SSG-Office-Assistant-App/

That's it! 🚀

---

## 💡 Pro Tips

### Tip 1: Test Before Deploy
```bash
npm run build
npm run preview
```

### Tip 2: Check for Errors
```bash
# Build and check for errors
npm run build 2>&1 | tee build.log
```

### Tip 3: Quick Deploy Script
Create `quick-deploy.bat` (Windows):
```batch
@echo off
git add .
git commit -m "Quick update"
git push origin main
npm run deploy
echo.
echo Deployment complete! Visit your site in 2-6 minutes.
pause
```

### Tip 4: View Deployment Logs
```bash
# View gh-pages branch commits
git log origin/gh-pages --oneline -5
```

---

## 🆘 Need Help?

If you encounter issues:

1. **Check this guide** - Most issues are covered here
2. **Check deployment status** - https://github.com/elijahtugad2005/Prototype-SSG-Office-Assistant-App/deployments
3. **Check browser console** - Press F12 on your site
4. **Clear cache** - Ctrl + Shift + Delete
5. **Wait longer** - Sometimes takes 10 minutes

---

## ✨ You're Ready!

Follow the steps above, and your site will be live!

**Start here**:
```bash
git add .
git commit -m "Deploy to GitHub Pages"
git push origin main
npm run deploy
```

Good luck! 🎊
