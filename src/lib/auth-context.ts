import { createContext } from 'react';
import type { AppUser } from '../types';

export interface AuthValue {
  user: AppUser | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);
