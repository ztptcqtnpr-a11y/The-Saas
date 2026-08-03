"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type MenuItem = { id: string; name: string; name_ar: string | null; description_en: string | null; description_ar: string | null; price: number };
type OrderLine = { item: MenuItem; qty: number; notes: string };

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/qr-order";

async function qrOrderApi(action: string, qrToken: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, qrToken, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function QrOrderPage() {
  const params = useParams();
  const qrToken = params.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [tableNumber, setTableNumber] = useState("");
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [order, setOrder] = useState<OrderLine[]>([]);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await qrOrderApi("get_menu", qrToken);
        setMenu(res.items);
        setTableNumber(res.tableNumber);
        setLang(res.defaultLanguage === "ar" ? "ar" : "en");
      } catch (e: any) {
        setError(e.message || "This table code is no longer valid.");
      }
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken]);

  function addItem(item: MenuItem) {
    setOrder((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) return prev.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { item, qty: 1, notes: "" }];
    });
  }
  function changeQty(itemId: string, delta: number) {
    setOrder((prev) => prev.map((l) => (l.item.id === itemId ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0));
  }
  function setNote(itemId: string, notes: string) {
    setOrder((prev) => prev.map((l) => (l.item.id === itemId ? { ...l, notes } : l)));
  }

  const VAT_RATE = 0.10;
  const subtotal = order.reduce((sum, l) => sum + l.item.price * l.qty, 0);
  const vatAmount = subtotal * VAT_RATE;
  const total = subtotal + vatAmount;

  async function sendOrder() {
    if (order.length === 0) return;
    setSending(true);
    try {
      await qrOrderApi("create_order", qrToken, {
        items: order.map((l) => ({ menuItemId: l.item.id, quantity: l.qty, notes: l.notes || undefined })),
      });
      setSentMsg(lang === "ar" ? "تم إرسال طلبك ✓" : "Order sent to kitchen ✓");
      setOrder([]);
      setTimeout(() => setSentMsg(""), 3000);
    } catch {
      setSentMsg(lang === "ar" ? "فشل الإرسال، حاول مرة أخرى" : "Failed to send — try again.");
    }
    setSending(false);
  }

  const card = "bg-white border border-neutral-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500 bg-[#f6f7f9]">Loading menu...</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f7f9] px-4">
        <div className={`${card} p-6 max-w-sm text-center`}>
          <p className="text-sm text-neutral-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] px-4 py-5 max-w-md mx-auto" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm font-medium">{t("Table", "طاولة")} {tableNumber}</p>
        <button
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
          className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5"
        >
          {lang === "en" ? "العربية" : "English"}
        </button>
      </div>

      <p className="text-xs text-neutral-500 mb-2">{t("Menu", "القائمة")}</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {menu.map((item) => (
          <button key={item.id} onClick={() => addItem(item)} className={`${card} text-left p-3`}>
            <p className="text-sm">{lang === "ar" && item.name_ar ? item.name_ar : item.name}</p>
            {(lang === "ar" ? item.description_ar : item.description_en) && (
              <p className="text-xs text-neutral-400 mt-0.5">{lang === "ar" ? item.description_ar : item.description_en}</p>
            )}
            <p className="text-xs text-neutral-500 mt-1">BHD {Number(item.price).toFixed(3)}</p>
          </button>
        ))}
        {menu.length === 0 && <p className="text-xs text-neutral-400 col-span-2">{t("No menu items available.", "لا توجد أصناف متاحة.")}</p>}
      </div>

      {order.length > 0 && (
        <div className={`${card} p-4 mb-4`}>
          <p className="text-xs text-neutral-500 mb-2">{t("Your order", "طلبك")}</p>
          {order.map((l) => (
            <div key={l.item.id} className="py-1.5 border-b last:border-0 border-neutral-100">
              <div className="flex items-center justify-between text-sm">
                <span className="flex-1">{lang === "ar" && l.item.name_ar ? l.item.name_ar : l.item.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => changeQty(l.item.id, -1)} className="w-6 h-6 rounded-md border border-neutral-300 text-neutral-600">−</button>
                  <span className="w-5 text-center">{l.qty}</span>
                  <button onClick={() => changeQty(l.item.id, 1)} className="w-6 h-6 rounded-md border border-neutral-300 text-neutral-600">+</button>
                  <span className="w-16 text-right">BHD {(l.item.price * l.qty).toFixed(3)}</span>
                </div>
              </div>
              <input
                value={l.notes}
                onChange={(e) => setNote(l.item.id, e.target.value)}
                placeholder={t("Note (e.g. no sugar)", "ملاحظة (مثال: بدون سكر)")}
                className="w-full text-xs border border-neutral-200 rounded-md px-2 py-1 mt-1 outline-none focus:border-neutral-400"
              />
            </div>
          ))}
          <div className="flex justify-between text-sm text-neutral-500 mt-2 pt-2 border-t border-neutral-100">
            <span>{t("Subtotal", "المجموع الفرعي")}</span><span>BHD {subtotal.toFixed(3)}</span>
          </div>
          <div className="flex justify-between text-sm text-neutral-500">
            <span>{t("VAT (10%)", "ضريبة القيمة المضافة (10%)")}</span><span>BHD {vatAmount.toFixed(3)}</span>
          </div>
          <div className="flex justify-between text-sm font-medium mt-1">
            <span>{t("Total", "الإجمالي")}</span><span>BHD {total.toFixed(3)}</span>
          </div>
        </div>
      )}

      {sentMsg && <p className="text-sm text-center text-green-700 mb-2">{sentMsg}</p>}

      <button onClick={sendOrder} disabled={sending || order.length === 0} className="w-full bg-neutral-900 text-white text-sm rounded-lg py-3 disabled:opacity-40">
        {sending ? t("Sending...", "جاري الإرسال...") : t("Send order", "إرسال الطلب")}
      </button>
    </div>
  );
}
