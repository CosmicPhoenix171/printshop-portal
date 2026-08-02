import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { get, ref } from 'firebase/database';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth, db } from '../firebase';
import { checkAdmin, saveProfile } from '../services';
import type { UserProfile } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(displayName: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  refreshProfile(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadProfile(currentUser: User) {
    const snapshot = await get(ref(db, `userProfiles/${currentUser.uid}`));
    setProfile(snapshot.exists() ? (snapshot.val() as UserProfile) : null);
    setIsAdmin(await checkAdmin(currentUser.uid));
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await loadProfile(currentUser);
      } else {
        setProfile(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    isAdmin,
    loading,
    async login(email, password) {
      await signInWithEmailAndPassword(auth, email, password);
    },
    async register(displayName, email, password) {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName });
      await sendEmailVerification(credential.user);
      const record: UserProfile = {
        uid: credential.user.uid,
        email,
        displayName,
        accountStatus: 'Active',
        createdAt: Date.now(),
      };
      await saveProfile(record);
      setProfile(record);
    },
    async logout() {
      await signOut(auth);
    },
    async resetPassword(email) {
      await sendPasswordResetEmail(auth, email);
    },
    async refreshProfile() {
      if (auth.currentUser) await loadProfile(auth.currentUser);
    },
  }), [user, profile, isAdmin, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
