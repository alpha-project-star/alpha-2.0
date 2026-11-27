// src/lib/auth.ts
import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  linkWithPopup,
  GoogleAuthProvider,
  signOut,
  User,
} from "firebase/auth";
import { auth } from "./firebase";
import { reminderContextManager } from "./reminder-context";
import { setStoreUser } from "./alpha-store";

export type AuthState = 
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'unauthenticated' }
  | { status: 'error'; error: Error };

const AuthContext = createContext<AuthState>({ status: 'loading' });

let bootstrapPromise: Promise<User | null> | null = null;
let bootstrapAttempted = false;

/**
 * Signs in user with Google OAuth popup.
 */
export async function signInWithGoogle(): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  const currentUser = auth.currentUser;

  // Link Google to the anonymous identity first so its UID-scoped local data
  // and Firestore ownership remain attached to the same account.
  if (currentUser?.isAnonymous) {
    try {
      const linked = await linkWithPopup(currentUser, provider);
      return linked.user;
    } catch (error: any) {
      if (error?.code === "auth/credential-already-in-use" || error?.code === "auth/email-already-in-use") {
        throw new Error(
          "That Google account already belongs to another Alpha identity. Your current local data has been kept separate; export it before signing into the existing account."
        );
      }
      throw error;
    }
  }

  const res = await signInWithPopup(auth, provider);
  return res.user;
}

/**
 * Signs out the current Firebase user.
 */
export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Returns the current authenticated Firebase user, awaiting any in-flight
 * anonymous authentication bootstrap if one is currently in progress.
 */
export async function ensureAuthenticatedUser(): Promise<User | null> {
  if (auth.currentUser) return auth.currentUser;
  if (bootstrapPromise) {
    try {
      return await bootstrapPromise;
    } catch {
      return null;
    }
  }
  return null;
}

export function _resetAuthBootstrapForTesting(): void {
  bootstrapPromise = null;
  bootstrapAttempted = false;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        if (!isMounted) return;

        if (user) {
          bootstrapAttempted = true;
          setStoreUser(user.uid);
          if (reminderContextManager.getContext(user.uid) === null) {
            reminderContextManager.clear();
          }
          setState({ status: 'authenticated', user });
        } else {
          // User is null: if we have not yet attempted anonymous bootstrap, do it now
          if (!bootstrapAttempted) {
            bootstrapAttempted = true;
            try {
              if (!bootstrapPromise) {
                bootstrapPromise = signInAnonymously(auth).then((cred) => cred.user);
              }
              const anonUser = await bootstrapPromise;
              if (isMounted) {
                if (anonUser) {
                  setStoreUser(anonUser.uid);
                  if (reminderContextManager.getContext(anonUser.uid) === null) {
                    reminderContextManager.clear();
                  }
                  setState({ status: 'authenticated', user: anonUser });
                } else {
                  setStoreUser(null);
                  reminderContextManager.clear();
                  setState({ status: 'unauthenticated' });
                }
              }
            } catch (err: any) {
              if (isMounted) {
                setStoreUser(null);
                reminderContextManager.clear();
                setState({ status: 'unauthenticated' });
              }
            } finally {
              bootstrapPromise = null;
            }
          } else {
            // Already bootstrapped and user is legitimately null (e.g. sign out)
            setStoreUser(null);
            reminderContextManager.clear();
            setState({ status: 'unauthenticated' });
          }
        }
      },
      (error) => {
        if (isMounted) {
          setState({ status: 'error', error });
        }
      }
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

