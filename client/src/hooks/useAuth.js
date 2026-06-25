import { useState, useEffect } from "react";
import { supabase } from "../api/client";

// Auth: session bootstrap + login. handleSignOut stays in App.js because it
// also resets app-wide vault/Q&A state. Extracted verbatim from App.js.
export function useAuth() {
const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  // ── Bootstrap auth session ────────────────────────────────────────────────────
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        const role = session.user?.app_metadata?.role || "user";
        setUserRole(role);
      }
      setAuthLoading(false);
    });

    // Listen for auth state changes (sign in / sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        const role = session.user?.app_metadata?.role || "user";
        setUserRole(role);
      } else {
        setUserRole(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) return;
    setLoggingIn(true);
    setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setLoginError("Incorrect email or password. Please try again.");
      setPassword("");
    }
    setLoggingIn(false);
  };

  return {
    authLoading, session, userRole,
    email, setEmail, password, setPassword,
    loginError, setLoginError, loggingIn, setLoggingIn,
    handleLogin,
  };
}
