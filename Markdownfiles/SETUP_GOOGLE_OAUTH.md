# Google OAuth Setup Guide

## Step 1: Enable Google Sign-In in Firebase Console

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Select your project "ssg-prototype"
3. Navigate to **Authentication → Sign-in method**
4. Click on **Google** from the list of providers
5. Toggle the **Enable** switch to ON
6. Enter your project's public-facing name (can be the same as Firebase app name)
7. Enter your support email
8. Click **Save**

## Step 2: Get Google OAuth Client ID and Secret

### Option A: Use Firebase-generated OAuth credentials
1. In Firebase Console, go to **Project Settings → General**
2. Scroll down to **Your apps** section
3. Find your web app and click the gear icon ⚙️
4. Go to **SDK setup and configuration**
5. Copy the "Web API Key" (this is your Google OAuth Client ID for Firebase)

### Option B: Create Google Cloud OAuth credentials (recommended for production)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project or create a new one
3. Navigate to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth client ID**
5. Select **Web application** as application type
6. Enter a name (e.g., "SSG App Web Client")
7. Add authorized JavaScript origins:
   - `http://localhost:3000` (for development)
   - `http://localhost:5000` (for backend if separate)
   - Your production domain (e.g., `https://yourdomain.com`)
8. Add authorized redirect URIs:
   - `http://localhost:3000/__/auth/handler` (Firebase default for local)
   - `https://yourproject.firebaseapp.com/__/auth/handler` (Firebase hosting)
9. Click **Create**
10. Copy the **Client ID** and **Client Secret**
11. Add these to your `.env.local` file:
```
VITE_GOOGLE_OAUTH_CLIENT_ID=your_client_id_here
VITE_GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret_here
```

## Step 3: Configure Firebase for Google OAuth

1. Return to Firebase Console → Authentication → Sign-in method → Google
2. Under **Web SDK configuration**:
   - Paste your Google Cloud Client ID in the field
   - Paste your Google Cloud Client Secret in the field (if required)
3. Click **Save**

## Step 4: Update Environment Variables

Copy the credentials to your environment files:

```bash
# In .env.local (development)
VITE_GOOGLE_OAUTH_CLIENT_ID=your_actual_client_id
VITE_GOOGLE_OAUTH_CLIENT_SECRET=your_actual_client_secret

# In production .env (Vercel/Netlify/Heroku)
VITE_GOOGLE_OAUTH_CLIENT_ID=your_actual_client_id
VITE_GOOGLE_OAUTH_CLIENT_SECRET=your_actual_client_secret
```

## Step 5: Test Google Sign-In

1. Start your development server: `npm run dev`
2. Go to your login page
3. Click "Sign in with Google"
4. Accept the Google permissions
5. You should be redirected back to your app authenticated

## Troubleshooting

### Common Issues:

1. **"Invalid OAuth client" error**
   - Make sure you've added your localhost domain to authorized JavaScript origins
   - Check that the Client ID matches exactly

2. **Redirect URI mismatch**
   - Ensure Firebase and Google Cloud redirect URIs match
   - For development, use `http://localhost:3000`

3. **Firebase Auth not enabled**
   - Verify Google Sign-In is enabled in Firebase Console
   - Check that Firebase project is properly linked to Google Cloud project

4. **CORS errors**
   - Ensure backend has proper CORS headers configured
   - Check that frontend URL is in allowed origins

## Production Considerations

1. **Use HTTPS** in production (Firebase requires secure contexts)
2. **Restrict OAuth credentials** to your production domain
3. **Rotate secrets** periodically for security
4. **Monitor usage** in Google Cloud Console
5. **Set up email notifications** for suspicious activity

## Security Notes

- Never commit actual credentials to version control
- Use environment variables for all secrets
- Implement proper session management
- Add rate limiting for authentication attempts
- Consider adding 2-factor authentication for admin accounts

## Additional Resources

- [Firebase Google Sign-In Documentation](https://firebase.google.com/docs/auth/web/google-signin)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Firebase Authentication Security Rules](https://firebase.google.com/docs/rules/auth)