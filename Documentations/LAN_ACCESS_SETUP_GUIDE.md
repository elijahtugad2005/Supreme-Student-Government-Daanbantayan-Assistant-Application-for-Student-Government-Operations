# LAN Access Setup Guide - Goblessglobe WiFi 4

**Date**: January 2025  
**Network**: Goblessglobe wifi 4  
**Host Computer IP**: 192.168.254.108  
**Purpose**: Allow other devices on same WiFi to access the SSG Office Assistant

---

## ✅ Configuration Complete

Your React app is now configured to accept connections from other devices on the **Goblessglobe wifi 4** network.

### What Was Changed:

1. **✅ Vite Config** (`vite.config.js`)
   - Added `host: '0.0.0.0'` to listen on all network interfaces
   - Frontend will be accessible from network

2. **✅ Backend Server** (`backend/server.js`)
   - Changed `app.listen(PORT)` to `app.listen(PORT, '0.0.0.0')`
   - Added network IP detection and display

3. **✅ Backend CORS** (`backend/.env`)
   - Added `http://192.168.254.108:5173` to allowed origins
   - Backend will accept requests from network

4. **✅ Frontend Backend URL** (`.env.local`)
   - Changed `VITE_MONGODB_BACKEND_URL` to `http://192.168.254.108:3000`
   - Frontend will connect to backend via network IP

---

## 🚀 How to Start the Servers

### Step 1: Start Backend (in terminal 1)
```bash
cd backend
node server.js
```

**Expected Output**:
```
🚀 Server listening on port 3000
📄 Document API: http://localhost:3000/api/documents
❤️  Health check: http://localhost:3000/health
🌐 Network access: http://192.168.254.108:3000
   Share this URL with devices on the same WiFi network
```

### Step 2: Start Frontend (in terminal 2)
```bash
npm run dev
```

**Expected Output**:
```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.254.108:5173/
  ➜  press h + enter to show help
```

---

## 📱 How Other Users Can Access

### On the Same WiFi (Goblessglobe wifi 4)

**Share this URL with your users**:
```
http://192.168.254.108:5173/Prototype-SSG-Office-Assistant-App/
```

### Devices That Can Access:
- ✅ Laptops connected to Goblessglobe wifi 4
- ✅ Phones connected to Goblessglobe wifi 4
- ✅ Tablets connected to Goblessglobe wifi 4
- ✅ Desktop computers on the same network

### Requirements:
1. Device must be connected to **Goblessglobe wifi 4**
2. Both frontend and backend servers must be running on your computer
3. Your computer's firewall must allow incoming connections (see below)

---

## 🔥 Windows Firewall Configuration

You may need to allow Node.js through Windows Firewall.

### Quick Test:
1. On another device, try accessing: `http://192.168.254.108:5173/`
2. If it **doesn't load**, firewall is likely blocking it

### Allow Node.js Through Firewall:

**Option A: Add Firewall Rule (Recommended)**
```powershell
# Run PowerShell as Administrator, then:

# Allow Vite (port 5173)
New-NetFirewallRule -DisplayName "Vite Dev Server" -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow

# Allow Backend (port 3000)
New-NetFirewallRule -DisplayName "Express Backend" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

**Option B: Windows Firewall GUI**
1. Open Windows Security
2. Click "Firewall & network protection"
3. Click "Allow an app through firewall"
4. Click "Change settings"
5. Find "Node.js" or add it manually
6. Check both "Private" and "Public" checkboxes
7. Click OK

---

## 🧪 Testing

### Test 1: From Your Computer
```
http://localhost:5173/Prototype-SSG-Office-Assistant-App/
```
Should work as usual ✅

### Test 2: From Another Device on Same WiFi
```
http://192.168.254.108:5173/Prototype-SSG-Office-Assistant-App/
```
Should show the same app ✅

### Test 3: Backend Health Check
```
http://192.168.254.108:3000/health
```
Should return:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-XX...",
  "services": {
    "mongodb": "connected",
    "firebase": "initialized"
  }
}
```

---

## 🐛 Troubleshooting

### Problem: "This site can't be reached" on other devices

**Cause**: Windows Firewall blocking connections

**Solution**: 
1. Run the PowerShell commands above
2. Or temporarily disable Windows Firewall (not recommended for production)

### Problem: Backend API calls fail (CORS errors)

**Cause**: Backend ALLOWED_ORIGINS doesn't include network IP

**Solution**: Check `backend/.env` has:
```
ALLOWED_ORIGINS=http://localhost:5173,http://192.168.254.108:5173
```

### Problem: Frontend can't connect to backend

**Cause**: `.env.local` still has `localhost` instead of network IP

**Solution**: Verify `.env.local` has:
```
VITE_MONGODB_BACKEND_URL=http://192.168.254.108:3000
```

### Problem: Network IP changed

**Your router may assign a different IP after restart**

**Solution**:
1. Run `ipconfig` to find new IP
2. Update `backend/.env` ALLOWED_ORIGINS
3. Update `.env.local` VITE_MONGODB_BACKEND_URL
4. Restart both servers

---

## 📝 Notes

### Static IP (Optional)
To avoid IP changes, set a static IP:
1. Open "Network & Internet settings"
2. Click "Change adapter options"
3. Right-click Wi-Fi → Properties
4. Select "Internet Protocol Version 4 (TCP/IPv4)"
5. Click Properties
6. Select "Use the following IP address"
7. Enter: `192.168.254.108` (or reserve in router DHCP)

### Security Considerations
- ⚠️ Only share access with trusted users on your network
- ⚠️ Don't expose this to public internet without authentication
- ⚠️ Consider using VPN for remote access
- ✅ Firebase Authentication is already protecting the app

### For Production Deployment
This setup is for **local testing/presentation only**. For production:
- Deploy to a hosting service (Railway, Vercel, etc.)
- Use proper domain name and HTTPS
- Configure production environment variables

---

## 🎯 Quick Reference

| What | URL |
|------|-----|
| **Frontend (you)** | http://localhost:5173/ |
| **Frontend (others)** | http://192.168.254.108:5173/Prototype-SSG-Office-Assistant-App/ |
| **Backend (you)** | http://localhost:3000 |
| **Backend (others)** | http://192.168.254.108:3000 |

**WiFi Network**: Goblessglobe wifi 4  
**Host Computer IP**: 192.168.254.108

---

**Last Updated**: January 2025  
**Status**: ✅ Configuration Complete, Ready for LAN Access

