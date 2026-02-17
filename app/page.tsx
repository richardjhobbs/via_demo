"use client";

import { useEffect, useMemo, useState } from "react";

type Offer = {
  id: string;
  sellerName: string;
  headline: string;
  imageUrl: string;
  productUrl: string;
  sourceLabel: string;
  priceText: string;
  deliveryText: string;
  reliabilityLabel: "Verified" | "Reliable" | "New";
  fastReplyLabel: "Replies fast" | "Normal reply";
};

type ThreadEvent = {
  id: string;
  ts: string;
  who: "You" | "Your assistant" | "Seller assistant";
  text: string;
};

type ThreadState = {
  threadId: string;
  status: string;
  requestText: string;
  selectedOfferId?: string | null;
  offers: Offer[];
  events: ThreadEvent[];
  kpis: {
    elapsedSeconds?: number | null;
    offersCount: number;
    stageLabel: string;
    confirmed: boolean;
    category?: string;
  };
  token: string;
};

function nowTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("via_demo_theme");
  if (saved === "dark" || saved === "light") return saved;
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export default function HomePage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mode, setMode] = useState<"buyer" | "seller">("buyer");
  const [requestText, setRequestText] = useState("");
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollOn, setPollOn] = useState(false);

  const heroSubtitle = useMemo(() => {
    if (mode === "buyer") {
      return "Type what you want. Your assistant shares the request, collects offers, and helps you agree terms before you confirm.";
    }
    return "See how a seller can respond instantly, negotiate within rules, and convert real requests into confirmed orders.";
  }, [mode]);

  useEffect(() => {
    const t = nowTheme();
    setTheme(t);
    document.documentElement.dataset.theme = t;
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("via_demo_theme", next);
  }

  async function createThread() {
    const txt = requestText.trim();
    if (!txt) return;
    setLoading(true);
    setThread(null);
    try {
      const res = await fetch("/api/demo/thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestText: txt, mode })
      });
      if (!res.ok) throw new Error("Failed to start demo");
      const data = await res.json();
      setThread(data);
      setPollOn(true);
    } finally {
      setLoading(false);
    }
  }

 async function pollThread(t: ThreadState) {
  const res = await fetch(`/api/demo/thread/${t.threadId}`, {
    cache: "no-store",
    headers: { "x-demo-token": t.token }
  });
  if (!res.ok) return;

  const data = await res.json();
  setThread(data);

  // Stop polling once all 3 offers have arrived
  if ((data?.kpis?.offersCount ?? 0) >= 3) {
    setPollOn(false);
  }

  // Also stop if confirmed (final)
  if (data?.kpis?.confirmed) {
    setPollOn(false);
  }
}


  useEffect(() => {
    if (!pollOn || !thread?.threadId) return;
    const current = thread;
    const timer = setInterval(() => pollThread(current), 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollOn, thread?.threadId]);

  async function selectOffer(offerId: string) {
    if (!thread?.threadId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/demo/thread/${thread.threadId}/select-offer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-demo-token": thread.token
        },
        body: JSON.stringify({ offerId })
      });
      if (!res.ok) throw new Error("Failed to select offer");
      const data = await res.json();
      setThread(data);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(text: string) {
    if (!thread?.threadId) return;
    const msg = text.trim();
    if (!msg) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/demo/thread/${thread.threadId}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-demo-token": thread.token
        },
        body: JSON.stringify({ text: msg })
      });
      if (!res.ok) throw new Error("Failed to send message");
      const data = await res.json();
      setThread(data);
      setPollOn(true);
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!thread?.threadId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/demo/thread/${thread.threadId}/confirm`, {
        method: "POST",
        headers: { "x-demo-token": thread.token }
      });
      if (!res.ok) throw new Error("Failed to confirm");
      const data = await res.json();
      setThread(data);
      setPollOn(false);
    } finally {
      setLoading(false);
    }
  }

  const routingLine =
    thread?.kpis?.category
      ? `Finding matches in ${thread.kpis.category}.`
      : "Finding matches in participating stores.";

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <h1>VIA Demo</h1>
          <p>{heroSubtitle}</p>
        </div>

        <div className="pills">
          <div className="pill" aria-label="Mode toggle">
            <button className={mode === "buyer" ? "active" : ""} onClick={() => setMode("buyer")}>Buyer</button>
            <button className={mode === "seller" ? "active" : ""} onClick={() => setMode("seller")}>Seller</button>
          </div>

          <div className="pill" aria-label="Theme toggle">
            <button className="active" onClick={toggleTheme}>
              {theme === "dark" ? "Night" : "Day"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="sectionTitle">
            <h2>Request</h2>
            <span
              className="smallLink"
              onClick={() => { setRequestText(""); setThread(null); setPollOn(false); }}
            >
              Reset
            </span>
          </div>

          <p>Describe what you want in normal language. You will approve the final step.</p>

          <div className="inputRow">
            <input
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              placeholder='Try: "Cycling helmet under £80" or "Dog treats delivered this week"'
            />
            <button disabled={loading || requestText.trim().length === 0} onClick={createThread}>
              {loading ? "Working..." : "Send"}
            </button>
          </div>

          <div style={{ height: 14 }} />

          <div className="threadItem">
            <div className="threadMeta">
              <span>Live routing</span>
              <span>{thread ? "Active" : "Waiting"}</span>
            </div>
            <div className="threadText">
              {thread ? routingLine : "Send a request to see offers arrive from participating sellers."}
            </div>
          </div>

          <div style={{ height: 14 }} />

          <div className="sectionTitle">
            <h2>Conversation</h2>
            <span className="smallLink">
              {thread ? `Status: ${thread.status}` : "Not started"}
            </span>
          </div>

          {!thread && (
            <div className="threadItem">
              <div className="threadMeta">
                <span>Waiting</span>
                <span>Start by sending a request</span>
              </div>
              <div className="threadText">
                This shows how an assistant turns your request into a clear message, collects offers, and helps you agree terms.
              </div>
            </div>
          )}

          {thread && thread.events.map((e) => (
            <div className="threadItem" key={e.id}>
              <div className="threadMeta">
                <span>{e.who}</span>
                <span>{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
              <div className="threadText">{e.text}</div>
            </div>
          ))}

          {thread && (
            <div className="footerRow">
              <button
                onClick={() => {
                  const text = window.prompt("Ask for an adjustment or clarification:");
                  if (text) sendMessage(text);
                }}
                disabled={loading || !thread.selectedOfferId || thread.kpis.confirmed}
              >
                Ask a follow-up
              </button>

              <button
                onClick={confirm}
                disabled={loading || thread.status !== "AGREED" || thread.kpis.confirmed}
              >
                Confirm
              </button>
            </div>
          )}

          {thread && (
            <div className="kpi">
              <div className="k">
                <div className="l">Stage</div>
                <div className="v">{thread.kpis.stageLabel}</div>
              </div>
              <div className="k">
                <div className="l">Offers received</div>
                <div className="v">{thread.kpis.offersCount}</div>
              </div>
              <div className="k">
                <div className="l">Elapsed</div>
                <div className="v">{thread.kpis.elapsedSeconds ? `${thread.kpis.elapsedSeconds.toFixed(1)}s` : "-"}</div>
              </div>
              <div className="k">
                <div className="l">Confirmation</div>
                <div className="v">{thread.kpis.confirmed ? "Confirmed" : "Pending"}</div>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="sectionTitle">
            <h2>Offers</h2>
            <span className="smallLink">Pick one to open a conversation</span>
          </div>

          {!thread && (
            <div className="offer">
              <div className="offerTitle">No offers yet</div>
              <div className="badges">
                <span className="badge">Send a request first</span>
              </div>
            </div>
          )}

          {thread && thread.offers.map((o) => (
            <div className="offer" key={o.id}>
              <div className="offerTop" style={{ gap: 12 }}>
                <img
                  src={o.imageUrl}
                  alt={o.headline}
                  style={{
                    width: 86,
                    height: 64,
                    borderRadius: 10,
                    objectFit: "cover",
                    border: "1px solid var(--line)"
                  }}
                />

                <div style={{ flex: 1 }}>
                  <div className="offerTitle">{o.headline}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                    {o.priceText} , {o.deliveryText}
                  </div>

                  <div className="badges">
                    <span className={"badge " + (o.reliabilityLabel === "Verified" ? "good" : "")}>{o.reliabilityLabel}</span>
                    <span className="badge">{o.fastReplyLabel}</span>
                    <span className="badge">{o.sellerName}</span>
                    <span className="badge">{o.sourceLabel}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => selectOffer(o.id)}
                disabled={loading || thread.kpis.confirmed}
              >
                {thread.selectedOfferId === o.id ? "Selected" : "Open conversation"}
              </button>
            </div>
          ))}

          <div style={{ height: 10 }} />

          <div className="threadItem">
            <div className="threadMeta">
              <span>Roadmap</span>
              <span>Honest stages</span>
            </div>
            <div className="threadText">
              Assisted today, you confirm the final step.
              Guided next, assistants negotiate within clearer rules.
              Autonomous later, assistants complete purchases when conditions match.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
