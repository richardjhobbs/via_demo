
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

  debug?: {
    category?: string;
    cleanedQuery?: string;
    storesPicked?: Array<{ name?: string; label?: string; storeId?: string } | string>;
    toolUsed?: string;
    productCount?: number;
    firstProduct?: any;
  };
};

function nowTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("via_demo_theme");
  if (saved === "dark" || saved === "light") return saved;
  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function safeTime(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

function uniqStrings(input: Array<any> | undefined | null): string[] {
  if (!input) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of input) {
    const v =
      typeof x === "string"
        ? x
        : x?.label || x?.name || x?.storeId || JSON.stringify(x);
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export default function HomePage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mode, setMode] = useState<"buyer" | "seller">("buyer");
  const [requestText, setRequestText] = useState("");
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollOn, setPollOn] = useState(false);

  const [transparencyOn, setTransparencyOn] = useState(true);
  const [debugOn, setDebugOn] = useState(true);

  const threadStartRef = useRef<number | null>(null);
  const offerFirstSeenRef = useRef<Record<string, number>>({});

  const heroSubtitle = useMemo(() => {
    return "Live agent-to-agent commerce demo. Intent is interpreted, broadcast to merchants, responses arrive, negotiation happens, you confirm.";
  }, []);

  useEffect(() => {
    const t = nowTheme();
    setTheme(t);
    if (t === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    window.localStorage.setItem("via_demo_theme", next);
  }

  function resetAll() {
    setRequestText("");
    setThread(null);
    setPollOn(false);
    setLoading(false);
    threadStartRef.current = null;
    offerFirstSeenRef.current = {};
  }

  function recordOfferArrivals(nextThread: ThreadState) {
    if (!threadStartRef.current) threadStartRef.current = Date.now();
    const now = Date.now();
    for (const o of nextThread.offers ?? []) {
      if (!offerFirstSeenRef.current[o.id]) offerFirstSeenRef.current[o.id] = now;
    }
  }

  function offerAgeText(offerId: string) {
    const start = threadStartRef.current;
    const seen = offerFirstSeenRef.current[offerId];
    if (!start || !seen) return "";
    const secs = (seen - start) / 1000;
    if (!Number.isFinite(secs)) return "";
    return `${secs.toFixed(1)}s`;
  }

  async function createThread() {
    const txt = requestText.trim();
    if (!txt) return;

    setLoading(true);
    setThread(null);
    setPollOn(false);
    threadStartRef.current = Date.now();
    offerFirstSeenRef.current = {};

    try {
      const res = await fetch("/api/demo/thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestText: txt, mode, debug: debugOn })
      });
      if (!res.ok) throw new Error("Failed to start demo");

      const data = (await res.json()) as ThreadState;
      recordOfferArrivals(data);
      setThread(data);
      setPollOn(true);
    } finally {
      setLoading(false);
    }
  }

  async function pollThread(t: ThreadState) {
    const url = debugOn
      ? `/api/demo/thread/${t.threadId}?debug=1`
      : `/api/demo/thread/${t.threadId}`;

    const res = await fetch(url, {
      cache: "no-store",
      headers: { "x-demo-token": t.token }
    });

    if (!res.ok) return;

    const data = (await res.json()) as ThreadState;
    recordOfferArrivals(data);
    setThread(data);

    if ((data?.kpis?.offersCount ?? 0) >= 3) setPollOn(false);
    if (data?.kpis?.confirmed) setPollOn(false);
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
      const data = (await res.json()) as ThreadState;
      recordOfferArrivals(data);
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
      const data = (await res.json()) as ThreadState;
      recordOfferArrivals(data);
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
      const data = (await res.json()) as ThreadState;
      recordOfferArrivals(data);
      setThread(data);
      setPollOn(false);
    } finally {
      setLoading(false);
    }
  }

  const debugStores = uniqStrings(thread?.debug?.storesPicked);
  const debugCategory = thread?.debug?.category || thread?.kpis?.category || "";
  const debugQuery = thread?.debug?.cleanedQuery || "";
  const debugTool = thread?.debug?.toolUsed || "";

  const phaseLabel = (() => {
    if (!thread) return "Waiting for request";
    if (thread.kpis.confirmed) return "Confirmed";
    if (thread.status === "AGREED") return "Ready to confirm";
    if (thread.selectedOfferId) return "Negotiation";
    if ((thread.kpis.offersCount ?? 0) > 0) return "Collecting responses";
    return "Broadcasting request";
  })();

  return (
    <main>
      <div className="container">
        <div className="demo-top">
          <h1>VIA Demo</h1>
          <p className="subtitle">{heroSubtitle}</p>

          <div className="demo-controls">
            <button
              className={"demo-pill " + (mode === "buyer" ? "active" : "")}
              onClick={() => setMode("buyer")}
            >
              Buyer view
            </button>
            <button
              className={"demo-pill " + (mode === "seller" ? "active" : "")}
              onClick={() => setMode("seller")}
            >
              Seller view
            </button>

            <button
              className={"demo-pill " + (transparencyOn ? "active" : "")}
              onClick={() => setTransparencyOn((v) => !v)}
            >
              Transparency
            </button>

            <button
              className={"demo-pill " + (debugOn ? "active" : "")}
              onClick={() => setDebugOn((v) => !v)}
            >
              Debug
            </button>

            <button className="demo-pill active" onClick={toggleTheme}>
              {theme === "dark" ? "Night" : "Day"}
            </button>
          </div>
        </div>

        <div className="demo-split">
          {/* LEFT */}
          <div className="card">
            <div className="demo-section-title">
              <h2>Request</h2>
              <span className="demo-smalllink" onClick={resetAll}>Reset</span>
            </div>

            <p>
              Describe what you want. The assistant interprets intent, broadcasts to multiple merchants,
              collects responses, negotiates, and you approve the final step.
            </p>

            <div style={{ height: 12 }} />

            <div className="demo-row">
              <input
                type="text"
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                placeholder='Try: "Cycling helmet under 80" or "Dog treats delivered this week"'
              />
              <button className="cta-button" disabled={loading || requestText.trim().length === 0} onClick={createThread}>
                {loading ? "Working..." : "Send"}
              </button>
            </div>

            <div style={{ height: 16 }} />

            <div className="content-section">
              <h3>Agent orchestration</h3>
              <p><b>Current phase:</b> {phaseLabel}</p>
              <p style={{ opacity: 0.8 }}>
                This is a live demo. Speed is not the point. Clarity of agent coordination is.
              </p>
            </div>

            <div className="content-section">
              <h3>Timeline</h3>

              <div className="demo-item">
                <div className="demo-meta"><span>1. Interpret intent</span><span>{thread ? "Done" : "Pending"}</span></div>
                <div className="demo-text">
                  {thread ? (
                    <>
                      Category: <b>{thread.kpis.category ?? "Unknown"}</b>
                      {debugQuery ? <div className="demo-muted" style={{ marginTop: 6 }}>Clean query: {debugQuery}</div> : null}
                    </>
                  ) : (
                    "Waiting for your request."
                  )}
                </div>
              </div>

              <div className="demo-item">
                <div className="demo-meta"><span>2. Broadcast to merchants</span><span>{thread ? "Active" : "Pending"}</span></div>
                <div className="demo-text">
                  {thread ? (
                    debugStores.length ? (
                      <>
                        Routed to: <span className="demo-muted">{debugStores.join(" , ")}</span>
                        {debugTool ? <div className="demo-muted" style={{ marginTop: 6 }}>Tool: {debugTool}</div> : null}
                      </>
                    ) : (
                      "Broadcast list not shown (debug payload not present)."
                    )
                  ) : (
                    "Waiting."
                  )}
                </div>
              </div>

              <div className="demo-item">
                <div className="demo-meta"><span>3. Collect responses</span><span>{thread ? `${thread.kpis.offersCount}/3` : "Pending"}</span></div>
                <div className="demo-text">
                  {thread ? "Seller agents respond with live products (image, URL, price when available)." : "Waiting."}
                </div>
              </div>

              <div className="demo-item">
                <div className="demo-meta"><span>4. Negotiate</span><span>{thread?.selectedOfferId ? "Active" : "Pending"}</span></div>
                <div className="demo-text">
                  {thread?.selectedOfferId ? "Negotiation happens inside the thread, with structured constraints." : "Select an offer to begin."}
                </div>
              </div>

              <div className="demo-item">
                <div className="demo-meta"><span>5. Confirm</span><span>{thread?.status === "AGREED" ? "Ready" : thread?.kpis?.confirmed ? "Done" : "Pending"}</span></div>
                <div className="demo-text">
                  {thread?.kpis?.confirmed ? "Buyer confirmed, thread complete." : "Final step always requires buyer approval."}
                </div>
              </div>
            </div>

            <div className="content-section">
              <h3>Conversation</h3>

              {!thread ? (
                <div className="demo-item">
                  <div className="demo-meta"><span>Waiting</span><span>Not started</span></div>
                  <div className="demo-text">Send a request to see the agent coordination thread.</div>
                </div>
              ) : (
                thread.events.map((e) => (
                  <div className="demo-item" key={e.id}>
                    <div className="demo-meta"><span>{e.who}</span><span>{safeTime(e.ts)}</span></div>
                    <div className="demo-text">{e.text}</div>
                  </div>
                ))
              )}

              {thread ? (
                <div className="demo-actions">
                  <button
                    className="cta-button"
                    onClick={() => {
                      const text = window.prompt("Ask for an adjustment or clarification:");
                      if (text) sendMessage(text);
                    }}
                    disabled={loading || !thread.selectedOfferId || thread.kpis.confirmed}
                  >
                    Ask a follow-up
                  </button>

                  <button
                    className="cta-button"
                    onClick={confirm}
                    disabled={loading || thread.status !== "AGREED" || thread.kpis.confirmed}
                  >
                    Confirm
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* RIGHT */}
          <div className="card">
            <div className="demo-section-title">
              <h2>Offers</h2>
              <span className="demo-smalllink">Select one to negotiate</span>
            </div>

            {!thread ? (
              <div className="content-section">
                <h3>No offers yet</h3>
                <p>Send a request to broadcast to merchants and see responses arrive.</p>
              </div>
            ) : (
              thread.offers.map((o) => {
                const selected = thread.selectedOfferId === o.id;
                const arrived = offerAgeText(o.id);

                return (
                  <div className={"demo-offer " + (selected ? "selected" : "")} key={o.id}>
                    <div className="demo-offer-top">
                      <img className="demo-offer-img" src={o.imageUrl} alt={o.headline} />
                      <div style={{ flex: 1 }}>
                        <div className="demo-offer-title">{o.headline}</div>
                        <div className="demo-muted">
                          {o.priceText} , {o.deliveryText}
                          {arrived ? <span> , received {arrived}</span> : null}
                        </div>

                        <div className="demo-badges">
                          <span className={"demo-badge " + (o.reliabilityLabel === "Verified" ? "good" : "")}>
                            {o.reliabilityLabel}
                          </span>
                          <span className="demo-badge">{o.fastReplyLabel}</span>
                          <span className="demo-badge">{o.sellerName}</span>
                          <span className="demo-badge">{o.sourceLabel}</span>
                        </div>

                        <div style={{ marginTop: 10 }}>
                          <a href={o.productUrl} target="_blank" rel="noreferrer">
                            View product
                          </a>
                        </div>
                      </div>
                    </div>

                    <button className="cta-button" onClick={() => selectOffer(o.id)} disabled={loading || thread.kpis.confirmed}>
                      {selected ? "Selected" : "Negotiate with seller agent"}
                    </button>
                  </div>
                );
              })
            )}

            {transparencyOn ? (
              <div className="content-section">
                <h3>Agent transparency</h3>

                {!thread ? (
                  <p>When active, this shows intent routing, merchant broadcast, and tool usage.</p>
                ) : (
                  <>
                    <p>
                      <b>Intent category:</b> {debugCategory || "Unknown"}
                    </p>
                    {debugQuery ? <p><b>Clean query:</b> {debugQuery}</p> : null}
                    {debugStores.length ? <p><b>Broadcast to:</b> {debugStores.join(" , ")}</p> : <p><b>Broadcast to:</b> Not shown (debug payload missing).</p>}
                    {debugTool ? <p><b>MCP tool:</b> {debugTool}</p> : null}
                    <p><b>Offers received:</b> {thread.kpis.offersCount} / 3</p>
                    <p style={{ opacity: 0.8 }}>
                      Confirm is always gated by buyer approval. This is a demonstration of agent coordination, not a checkout funnel.
                    </p>
                  </>
                )}
              </div>
            ) : null}

            <div className="content-section">
              <h3>Roadmap</h3>
              <p>Assisted today, you confirm the final step.</p>
              <p>Guided next, assistants negotiate within clearer rules.</p>
              <p>Autonomous later, assistants complete purchases when conditions match.</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
