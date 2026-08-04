"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const supabase = createClient();

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      setError("Incorrect email or password.");
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    setLoading(false);

    if (profile?.role === "super_admin") {
      router.push("/admin");
    } else if (profile?.role === "owner" || profile?.role === "manager") {
      router.push("/owner");
    } else {
      setError("This account has no dashboard access.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f7f9] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-lg bg-neutral-900 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 2v7c0 1.1.9 2 2 2h1v11" /><path d="M7 2v20" /><path d="M17 2v20" /><path d="M17 2c-3 0-3 3-3 5v3c0 2 0 5 3 5" />
            </svg>
          </div>
          <span className="text-sm font-semibold tracking-tight text-neutral-900">RestaurantOS</span>
        </div>

        <form
          onSubmit={handleLogin}
          className="bg-white border border-neutral-200 rounded-2xl px-8 py-9 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]"
        >
          <h1 className="text-[19px] font-semibold text-neutral-900 mb-1">Sign in</h1>
          <p className="text-sm text-neutral-500 mb-7">
            Enter your credentials to access your dashboard.
          </p>

          <label className="block text-xs font-medium text-neutral-600 mb-1.5">Email</label>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-neutral-300 rounded-lg px-3.5 py-2.5 mb-4 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/5"
            placeholder="you@example.com"
          />

          <label className="block text-xs font-medium text-neutral-600 mb-1.5">Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-neutral-300 rounded-lg px-3.5 py-2.5 mb-5 text-sm outline-none transition-colors focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/5"
            placeholder="••••••••"
          />

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-lg px-3 py-2 mb-4">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-neutral-900 hover:bg-neutral-800 transition-colors text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-400 mt-6">
          No account? Access is provided by your platform administrator.
        </p>
      </div>
    </div>
  );
}
