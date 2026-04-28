/**
 * Auth.js (NextAuth v5) configuration with Google provider.
 *
 * Requested scopes include `drive.file`, which limits the app to files it
 * creates or that the user explicitly opens with it — so the app cannot
 * see your other Drive content.
 *
 * Tokens are stored in JWT session cookies. We propagate the access token
 * (and a refresh token if granted) to the session so the storage layer can
 * call the Drive API on the user's behalf.
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const DRIVE_SCOPE =
  "openid email profile https://www.googleapis.com/auth/drive.file";

/**
 * Google sign-in is enabled only when both AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET
 * are set. If they're missing, the app boots in demo-only mode (no providers,
 * no sign-in button, data lives in localStorage). This lets you deploy without
 * any OAuth setup — just set AUTH_SECRET.
 */
export const GOOGLE_AUTH_ENABLED = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

const providers = GOOGLE_AUTH_ENABLED
  ? [
      Google({
        authorization: {
          params: {
            scope: DRIVE_SCOPE,
            prompt: "consent",
            access_type: "offline",
          },
        },
      }),
    ]
  : [];

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 3500 * 1000;
      }
      // Refresh the access token if it's expired and we have a refresh token
      if (
        token.expiresAt &&
        Date.now() > (token.expiresAt as number) - 60 * 1000 &&
        token.refreshToken
      ) {
        try {
          const r = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: process.env.AUTH_GOOGLE_ID || "",
              client_secret: process.env.AUTH_GOOGLE_SECRET || "",
              grant_type: "refresh_token",
              refresh_token: token.refreshToken as string,
            }),
          });
          if (r.ok) {
            const data = await r.json();
            token.accessToken = data.access_token;
            token.expiresAt = Date.now() + (data.expires_in ?? 3500) * 1000;
            if (data.refresh_token) token.refreshToken = data.refresh_token;
          }
        } catch {
          // Silent — caller will see 401 and prompt re-auth.
        }
      }
      return token;
    },
    async session({ session, token }) {
      (session as { accessToken?: string }).accessToken = token.accessToken as
        | string
        | undefined;
      return session;
    },
  },
});
