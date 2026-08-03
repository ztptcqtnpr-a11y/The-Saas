const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/staff-api";

export async function staffApi(action: string, token: string, pin: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, token, pin, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
