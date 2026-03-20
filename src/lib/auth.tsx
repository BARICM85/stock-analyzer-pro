import { useMemo, useState } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import type { AppUser } from '../types';
import { AuthContext, type AuthValue } from './auth-context';
import { loadUser, saveUser } from './storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

function canUseFirebase(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
}

let firebaseAuth: ReturnType<typeof getAuth> | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (canUseFirebase()) {
  const app = initializeApp(firebaseConfig);
  firebaseAuth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(() => loadUser());

  const value = useMemo<AuthValue>(() => ({
    user,
    loginWithGoogle: async () => {
      if (firebaseAuth && googleProvider) {
        const result = await signInWithPopup(firebaseAuth, googleProvider);
        const next: AppUser = {
          uid: result.user.uid,
          displayName: result.user.displayName || 'Google User',
          email: result.user.email || undefined,
          provider: 'google',
        };
        saveUser(next);
        setUser(next);
        return;
      }

      // local fallback if firebase env vars are not set yet
      const fallback: AppUser = {
        uid: 'local-user',
        displayName: 'Local Demo User',
        provider: 'local',
      };
      saveUser(fallback);
      setUser(fallback);
    },
    logout: async () => {
      if (firebaseAuth) await signOut(firebaseAuth);
      saveUser(null);
      setUser(null);
    },
  }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
