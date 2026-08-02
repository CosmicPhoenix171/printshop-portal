import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { get, onValue, ref } from 'firebase/database';
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
  loginWithGoogle(): Promise<void>;
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
    let record = snapshot.exists() ? (snapshot.val() as UserProfile) : null;

    if (!record) {
      const email = currentUser.email ?? '';
      record = {
        uid: currentUser.uid,
        email,
        displayName: currentUser.displayName || email.split('@')[0] || 'Customer',
        accountStatus: 'Active',
        createdAt: Date.now(),
      };
      await saveProfile(record);
    }

    setProfile(record);
    setIsAdmin(await checkAdmin(currentUser.uid));
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      try {
        if (currentUser) {
          await loadProfile(currentUser);
        } else {
          setProfile(null);
          setIsAdmin(false);
        }
      } catch (reason) {
        console.error('Unable to load the authenticated user profile.', reason);
        setProfile(null);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    return onValue(
      ref(db, `userProfiles/${user.uid}`),
      (snapshot) => setProfile(snapshot.exists() ? (snapshot.val() as UserProfile) : null),
      (reason) => console.error('Unable to synchronize the authenticated user profile.', reason),
    );
  }, [user]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    profile,
    isAdmin,
    loading,
    async login(email, password) {
      await signInWithEmailAndPassword(auth, email, password);
    },
    async loginWithGoogle() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(auth, provider);
      const profileSnapshot = await get(ref(db, `userProfiles/${credential.user.uid}`));

      if (!profileSnapshot.exists()) {
        if (!credential.user.email) {
          await signOut(auth);
          throw new Error('Your Google account does not provide an email address.');
        }

        const record: UserProfile = {
          uid: credential.user.uid,
          email: credential.user.email,
          displayName: credential.user.displayName ?? credential.user.email.split('@')[0],
          accountStatus: 'Active',
          createdAt: Date.now(),
        };
        await saveProfile(record);
        setProfile(record);
      }
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
