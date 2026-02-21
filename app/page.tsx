"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Offer = {
  id: string;
  sellerName?: string;
  headline?: string;
  imageUrl?: string;
  productUrl?: string;
  priceText?: string;
  deliveryText?: string;
  sourceLabel?: string;
};

type ThreadEvent = {
  id: string;
  ts: string;
  who?: string;
  text: string;
};

type ThreadState = {
  threadId: string;
  status?: string;
  selectedOfferId?: string | null;
  offers: Offer[];
  events: ThreadEvent[];
  token: string;
  kpis?: {
    stageLabel?: string;
    confirmed?: boolean;
    offersCount?: number;
    category?: string;
  };
  debug?: any;
};

type IntentPlan = {
  category: "SNEAKERS" | "OUTDOORS" | "CYCLING" | "PET_SUPPLIES" | "NOT_SPECIFIED";
  core_item: string;
  required_terms: string[];
  preferred_terms: string[];
  excluded_terms: string[];
  search_query: string;
  broadcast_intent: string;
  missing_fields: string[];
  next_question: string | null;
};

type MiniTurn = { role: "user" | "assistant"; content: string };

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem("via_demo_theme");
  if (saved === "dark" || saved === "light") return saved;
  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  if (theme === "dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
}

function catLabel(c: IntentPlan["category"]) {
  if (c === "SNEAKERS") return "SNEAKERS";
  if (c === "OUTDOORS") return "OUTDOORS";
  if (c === "CYCLING") return "CYCLING";
  if (c === "PET_SUPPLIES") return "PET SUPPLIES";
  return "NOT SPECIFIED";
}

export default function Page() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [tab, setTab] = useState<"offers" | "transparency" | "debug">("offers");

  const [thread, setThread] = useState<ThreadState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollOn, setPollOn] = useState(false);

  // Broadcast window for "no offers" message
  const [broadcastStartedAt, setBroadcastStartedAt] = useState<number | null>(null);
  const [broadcastTimedOut, setBroadcastTimedOut] = useState(false);

  // LLM assist
  const [llmOn, setLlmOn] = useState(true);
  const [draft, setDraft] = useState("");
  const [miniTurns, setMiniTurns] = useState<MiniTurn[]>([]);
  const [intentPlan, setIntentPlan] = useState<IntentPlan | null>(null);
  const [statusLabel, setStatusLabel] = useState<"Idle" | "Clarifying" | "Broadcasting">("Idle");
  const [clarifyWorking, setClarifyWorking] = useState(false);

  const chatBoxRef = useRef<HTMLDivElement | null>(null);

  const heroSubtitle =
    "Live agent-to-agent commerce demo. Intent is interpreted, broadcast to merchants, responses arrive, negotiation happens, you confirm. See all NOTES below!";

  const notesText = useMemo(() => {
    return (
      "This is a visualization of part of what happens behind the scenes when agentic commerce takes place. " +
      "It shows intent being distributed, and merchant agents (these are actual retail operators) offering products " +
      "through the MCP server and relay constructed as part of the VIA protocol.\n\n" +
      "For the purposes of this demo, merchants and categories are restricted to:\n\n" +
      "SNEAKERS\nOUTDOORS\nCYCLING\nPET SUPPLIES\n\n" +
      "There are no pricing parameters. Feel free to test and see the process at work. There will be errors!"
    );
  }, []);

  useEffect(() => {
    const t = getInitialTheme();
    setTheme(t);
    applyTheme(t);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem("via_demo_theme", next);
  }

  function resetAll() {
    setDraft("");
    setMiniTurns([]);
    setIntentPlan(null);
    setStatusLabel("Idle");
    setClarifyWorking(false);

    setThread(null);
    setPollOn(false);
    setTab("offers");

    setBroadcastStartedAt(null);
    setBroadcastTimedOut(false);
  }

  useEffect(() => {
    const el = chatBoxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [miniTurns.length]);

  async function createThreadDirect(txt: string) {
    const text = txt.trim();
    if (!text) return;

    setLoading(true);
    setThread(null);

    try {
      const res = await fetch("/api/demo/thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestText: text, debug: true })
      });

      if (!res.ok) throw new Error("Failed to start demo thread");
      const data = (await res.json()) as ThreadState;

      setThread(data);
      setPollOn(true);

      setBroadcastStartedAt(Date.now());
      setBroadcastTimedOut(false);

      setTab("offers");
    } finally {
      setLoading(false);
    }
  }

  async function createThreadFromPlan(plan: IntentPlan) {
    setLoading(true);
    setThread(null);

    try {
      const res = await fetch("/api/demo/thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestText: plan.broadcast_intent,
          intent_plan: plan,
          debug: true
        })
      });

      if (!res.ok) throw new Error("Failed to start demo thread");
      const data = (await res.json()) as ThreadState;

      setThread(data);
      setPollOn(true);

      setBroadcastStartedAt(Date.now());
      setBroadcastTimedOut(false);

      setTab("offers");
    } finally {
      setLoading(false);
    }
  }

  async function askAgent() {
    const txt = draft.trim();
    if (!txt) return;

    if (!llmOn) {
      await createThreadDirect(txt);
      return;
    }

    setClarifyWorking(true);
    setStatusLabel("Clarifying");

    const historyForApi: MiniTurn[] = [...miniTurns, { role: "user", content: txt }].slice(-12);
    setMiniTurns(historyForApi);

    try {
      const res = await fetch("/api/llm/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userText: txt,
          history: historyForApi
        })
      });

      if (!res.ok) {
        setMiniTurns((prev) =>
          [
            ...prev,
            {
              role: "assistant",
              content:
                "LLM assist is not available right now. Switch LLM assist off to broadcast directly."
            }
          ].slice(-12)
        );
        setStatusLabel("Idle");
        setDraft("");
        return;
      }

      const data = await res.json();
      const plan: IntentPlan | null = data?.result?.intent_plan ?? null;
      const nextAction = data?.result?.next_action as "ASK_ONE_QUESTION" | "BROADCAST_NOW";

      if (!plan || !plan.category) {
        setMiniTurns((prev) =>
          [
            ...prev,
            {
              role: "assistant",
              content:
                "LLM returned an invalid plan. Switch LLM assist off to broadcast directly."
            }
          ].slice(-12)
        );
        setStatusLabel("Idle");
        setDraft("");
        return;
      }

      setIntentPlan(plan);

      const header = `Category: ${catLabel(plan.category)}.`;

      if (nextAction === "ASK_ONE_QUESTION" && plan.next_question) {
        setMiniTurns((prev) =>
          [...prev, { role: "assistant", content: `${header} ${plan.next_question}` }].slice(-12)
        );
        setStatusLabel("Clarifying");
        setDraft("");
        return;
      }

      setMiniTurns((prev) =>
        [...prev, { role: "assistant", content: `${header} Broadcasting now.` }].slice(-12)
      );
      setStatusLabel("Broadcasting");
      setDraft("");

      await createThreadFromPlan(plan);
      setStatusLabel("Idle");
    } finally {
      setClarifyWorking(false);
    }
  }

  async function pollThread(current: ThreadState) {
    const res = await fetch(`/api/demo/thread/${current.threadId}`, {
      cache: "no-store",
      headers: { "x-demo-token": current.token }
    });

    if (!res.ok) return;
    const data = (await res.json()) as ThreadState;
    setThread(data);

    const offersCount = data?.kpis?.offersCount ?? data?.offers?.length ?? 0;
    if (offersCount >= 3) setPollOn(false);
    if (data?.kpis?.confirmed) setPollOn(false);
  }

  useEffect(() => {
    if (!pollOn || !thread?.threadId) return;
    const current = thread;
    const timer = setInterval(() => pollThread(current), 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollOn, thread?.threadId]);

  // After a broadcast starts, wait up to 10s for offers.
  // Only show "no offers" message once the window is over and offers are still zero.
  useEffect(() => {
    if (!pollOn) return;
    if (!broadcastStartedAt) return;

    const timer = setInterval(() => {
      const offersNow = thread?.offers?.length ?? 0;
      const elapsed = Date.now() - broadcastStartedAt;

      if (offersNow > 0) {
        // Offers arrived, do not show "no offers"
        setBroadcastTimedOut(false);
        return;
      }

      if (elapsed >= 10000) {
        setBroadcastTimedOut(true);
        setPollOn(false);
      }
    }, 500);

    return () => clearInterval(timer);
  }, [pollOn, broadcastStartedAt, thread?.offers?.length]);

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
      setThread(data);
      setTab("transparency");
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
      setThread(data);
      setPollOn(true);

      // New merchant work started, reset the "no offers" window
      setBroadcastStartedAt(Date.now());
      setBroadcastTimedOut(false);
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
      setThread(data);
      setPollOn(false);
    } finally {
      setLoading(false);
    }
  }

  const stageLabel = thread?.kpis?.stageLabel ?? "Waiting for request";
  const categoryLabel = thread?.kpis?.category ?? "pending";
  const offersCount = thread?.kpis?.offersCount ?? thread?.offers?.length ?? 0;
  const confirmed = Boolean(thread?.kpis?.confirmed);
  const offerSelected = Boolean(thread?.selectedOfferId);

  const viaLogoSrc =
    theme === "dark" ? "/images/VIA_logo_large_white.png" : "/images/VIA_logo_large_black.png";

  const xIconSrc = theme === "dark" ? "/images/logo-white.png" : "/images/logo-black.png";

  const timeline = [
    {
      n: 1,
      title: "Interpret intent",
      status: thread ? "Done" : "Pending",
      desc: thread ? `Detected category: ${categoryLabel}` : "Waiting for your request."
    },
    {
      n: 2,
      title: "Broadcast to merchants",
      status: thread ? (offersCount > 0 ? "Active" : "Pending") : "Pending",
      desc: thread ? "Broadcasting to multiple merchants." : "Waiting."
    },
    {
      n: 3,
      title: "Collect responses",
      status: offersCount > 0 ? (offersCount >= 3 ? "Done" : "Active") : "Pending",
      desc: thread ? `${offersCount} offer(s) received.` : "Waiting."
    },
    {
      n: 4,
      title: "Negotiate",
      status: offerSelected ? "Active" : "Pending",
      desc: offerSelected ? "Negotiation open on selected offer." : "Select an offer to begin."
    },
    {
      n: 5,
      title: "Confirm",
      status: confirmed ? "Done" : "Pending",
      desc: confirmed ? "Confirmed." : "Final step always requires explicit buyer approval."
    }
  ];

  return (
    <>
      <header>
        <a href="https://getvia.xyz/index.html" className="logo" aria-label="VIA Home">
          <img id="logo" src={viaLogoSrc} alt="VIA" />
        </a>
      </header>

      <button className="theme-toggle" aria-label="Toggle day/night" onClick={toggleTheme}>
        <svg className="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>

        <svg className="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      </button>

      <main>
        <div className="container">
          <h1>VIA DEMO</h1>
          <p className="subtitle">{heroSubtitle}</p>

          <div className="demo-split" style={{ marginTop: 18 }}>
            {/* LEFT COLUMN */}
            <div className="card">
              <div className="demo-section-title">
                <h2>Intent</h2>
                <span className="demo-smalllink" onClick={resetAll}>
                  Reset
                </span>
              </div>

              <p style={{ marginTop: 10 }}>
                Describe what you want. If LLM assist is ON, you will answer one short question, sometimes two, then the request broadcasts automatically.
              </p>

              <div className="demo-controls" style={{ marginTop: 12, gap: 10 }}>
                <button
                  type="button"
                  className={"demo-pill " + (llmOn ? "active" : "")}
                  onClick={() => setLlmOn((v) => !v)}
                  disabled={loading || clarifyWorking}
                >
                  LLM assist: {llmOn ? "ON" : "OFF"}
                </button>

                <span className="demo-badge">{catLabel(intentPlan?.category ?? "NOT_SPECIFIED")}</span>
              </div>

              <div
                ref={chatBoxRef}
                style={{
                  marginTop: 12,
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  padding: 12,
                  maxHeight: 180,
                  overflowY: "auto"
                }}
              >
                {miniTurns.length === 0 ? (
                  <div style={{ opacity: 0.85 }}>
                    <b>Agent:</b> Tell me what you want. I will clarify, then broadcast.
                  </div>
                ) : (
                  miniTurns.map((t, i) => (
                    <div key={i} style={{ marginBottom: 10, opacity: 0.92 }}>
                      <b>{t.role === "user" ? "You" : "Agent"}:</b> {t.content}
                    </div>
                  ))
                )}
              </div>

              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  llmOn
                    ? 'Type your request, then answer the question. Example: "cycling jersey", then "size large".'
                    : 'Try: "Cycling helmet size M, breathable"\nOr: "Dog treats, grain free, deliver this week"'
                }
                rows={5}
                style={{ width: "100%", resize: "vertical", marginTop: 12 }}
              />

              <button
                className="cta-button"
                disabled={loading || clarifyWorking || draft.trim().length === 0}
                onClick={askAgent}
                style={{ width: "100%", marginTop: 12 }}
              >
                {llmOn ? (clarifyWorking ? "Working..." : "Send to agent") : loading ? "Working..." : "Send request"}
              </button>

              <div className="content-section" style={{ marginTop: 14 }}>
                <div className="demo-meta">
                  <span>Intent preview</span>
                  <span style={{ opacity: 0.85 }}>{statusLabel}</span>
                </div>
                <div className="demo-text" style={{ marginTop: 6 }}>
                  {intentPlan?.broadcast_intent ? intentPlan.broadcast_intent : draft.trim() || "Not set"}
                </div>
              </div>

              <div className="content-section" style={{ marginTop: 16 }}>
                <h3>Orchestration</h3>
                <p>
                  <b>Current phase:</b> {stageLabel}
                </p>
                <p style={{ opacity: 0.8 }}>
                  This is a live demo pulling real data from real stores to show agent coordination.
                </p>
              </div>

              <div className="content-section">
                <h3>Timeline</h3>
                {timeline.map((s) => (
                  <div className="demo-item" key={s.n}>
                    <div className="demo-meta">
                      <span>
                        {s.n}. {s.title}
                      </span>
                      <span>{s.status}</span>
                    </div>
                    <div className="demo-text">{s.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="card">
              {tab === "offers" && (
                <>
                  <div className="demo-section-title">
                    <h2>Offers</h2>
                    <span className="demo-smalllink">Select one to negotiate</span>
                  </div>

                  {!thread && (
                    <div className="content-section">
                      <h3>No offers yet</h3>
                      <p>Send a request to broadcast to merchants and see responses arrive.</p>
                    </div>
                  )}

                  {thread && (thread.offers?.length ?? 0) === 0 && !broadcastTimedOut && (
                    <div className="content-section">
                      <h3>Waiting for merchant responses</h3>
                      <p>Broadcast sent. Listening for offers from registered merchants.</p>
                    </div>
                  )}

                  {thread && (thread.offers?.length ?? 0) === 0 && broadcastTimedOut && (
                    <div className="content-section">
                      <h3>No matching offers</h3>
                      <p>
                        Sorry, none of our currently registered merchants has product like this in stock at the moment.
                        We are adding new suppliers so check back soon or look for something else!
                      </p>
                    </div>
                  )}

                  {thread &&
                    (thread.offers ?? []).map((o) => (
                      <div className="demo-offer" key={o.id}>
                        <div className="demo-offer-top">
                          {o.imageUrl ? (
                            <img className="demo-offer-img" src={o.imageUrl} alt={o.headline ?? "Offer"} />
                          ) : null}

                          <div style={{ flex: 1 }}>
                            <div className="demo-offer-title">{o.headline ?? "Offer"}</div>
                            <div className="demo-muted">
                              {(o.priceText ?? "Price varies")} , {(o.deliveryText ?? "Delivery varies")}
                            </div>

                            <div className="demo-badges" style={{ marginTop: 8 }}>
                              {o.sellerName ? <span className="demo-badge">{o.sellerName}</span> : null}
                              {o.sourceLabel ? <span className="demo-badge">{o.sourceLabel}</span> : null}
                            </div>

                            {o.productUrl ? (
                              <div style={{ marginTop: 10 }}>
                                <a href={o.productUrl} target="_blank" rel="noreferrer">
                                  View product
                                </a>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <button className="cta-button" onClick={() => selectOffer(o.id)} disabled={loading || confirmed}>
                          {thread.selectedOfferId === o.id ? "Selected" : "Select and negotiate"}
                        </button>
                      </div>
                    ))}
                </>
              )}

              {tab === "transparency" && (
                <>
                  <div className="demo-section-title">
                    <h2>Transparency</h2>
                    <span className="demo-smalllink">What the agent is doing</span>
                  </div>

                  {!thread && (
                    <div className="demo-item">
                      <div className="demo-meta">
                        <span>Not started</span>
                        <span>Waiting</span>
                      </div>
                      <div className="demo-text">Send a request first.</div>
                    </div>
                  )}

                  {thread && (
                    <>
                      <div className="demo-item">
                        <div className="demo-meta">
                          <span>Intent</span>
                          <span>{categoryLabel}</span>
                        </div>
                        <div className="demo-text">
                          Request is classified, then broadcast to multiple merchants in the matched category.
                        </div>
                      </div>

                      <div className="demo-item">
                        <div className="demo-meta">
                          <span>Responses</span>
                          <span>{offersCount}/3</span>
                        </div>
                        <div className="demo-text">Merchant responses are normalised into comparable offers.</div>
                      </div>

                      <div className="demo-item">
                        <div className="demo-meta">
                          <span>Negotiation</span>
                          <span>{offerSelected ? "Open" : "Not started"}</span>
                        </div>
                        <div className="demo-text">
                          {offerSelected ? "Selected offer is now the active thread." : "Select an offer to begin."}
                        </div>
                      </div>

                      <div className="demo-item">
                        <div className="demo-meta">
                          <span>Confirmation</span>
                          <span>{confirmed ? "Confirmed" : "Pending"}</span>
                        </div>
                        <div className="demo-text">Final step always requires explicit buyer approval.</div>
                      </div>

                      {intentPlan && (
                        <div className="demo-item">
                          <div className="demo-meta">
                            <span>LLM retrieval plan</span>
                            <span>{catLabel(intentPlan.category)}</span>
                          </div>
                          <div className="demo-text" style={{ whiteSpace: "pre-wrap" }}>
                            {`Merchant query: ${intentPlan.search_query}\n` +
                              `Required terms: ${(intentPlan.required_terms || []).join(", ") || "None"}\n` +
                              `Preferred terms: ${(intentPlan.preferred_terms || []).join(", ") || "None"}\n` +
                              `Excluded terms: ${(intentPlan.excluded_terms || []).join(", ") || "None"}`}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {tab === "debug" && (
                <>
                  <div className="demo-section-title">
                    <h2>Debug</h2>
                    <span className="demo-smalllink">Raw diagnostics</span>
                  </div>

                  {!thread && (
                    <div className="demo-item">
                      <div className="demo-meta">
                        <span>No data</span>
                        <span>Waiting</span>
                      </div>
                      <div className="demo-text">Start a request to see diagnostics.</div>
                    </div>
                  )}

                  {thread && (
                    <div className="demo-item">
                      <div className="demo-meta">
                        <span>Thread</span>
                        <span>{thread.threadId}</span>
                      </div>
                      <div className="demo-text" style={{ whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(
                          {
                            status: thread.status,
                            kpis: thread.kpis ?? null,
                            selectedOfferId: thread.selectedOfferId ?? null,
                            debug: thread.debug ?? null
                          },
                          null,
                          2
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div style={{ marginTop: 16 }}>
                <div className="demo-controls" style={{ justifyContent: "center" }}>
                  <button className={"demo-pill " + (tab === "offers" ? "active" : "")} onClick={() => setTab("offers")}>
                    Offers
                  </button>
                  <button
                    className={"demo-pill " + (tab === "transparency" ? "active" : "")}
                    onClick={() => setTab("transparency")}
                  >
                    Transparency
                  </button>
                  <button className={"demo-pill " + (tab === "debug" ? "active" : "")} onClick={() => setTab("debug")}>
                    Debug
                  </button>
                </div>
              </div>
            </div>

            {/* Conversation full width */}
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <div className="demo-section-title">
                <h2>Conversation</h2>
                <span className="demo-smalllink">{thread ? thread.status ?? "Active" : "Not started"}</span>
              </div>

              {!thread && (
                <div className="demo-item">
                  <div className="demo-meta">
                    <span>Waiting</span>
                    <span>Send a request</span>
                  </div>
                  <div className="demo-text">Send a request to see the agent coordination thread.</div>
                </div>
              )}

              {thread &&
                (thread.events ?? []).map((e) => (
                  <div className="demo-item" key={e.id}>
                    <div className="demo-meta">
                      <span>{e.who ?? "Agent"}</span>
                      <span>{new Date(e.ts).toLocaleTimeString()}</span>
                    </div>
                    <div className="demo-text">{e.text}</div>
                  </div>
                ))}

              {thread && (
                <div className="demo-actions">
                  <button
                    className="cta-button"
                    onClick={() => {
                      const text = window.prompt("Ask for an adjustment or clarification:");
                      if (text) sendMessage(text);
                    }}
                    disabled={loading || !offerSelected || confirmed}
                  >
                    Ask a follow-up
                  </button>

                  <button className="cta-button" onClick={confirm} disabled={loading || thread.status !== "AGREED" || confirmed}>
                    Confirm
                  </button>
                </div>
              )}
            </div>

            {/* NOTES full width */}
            <div className="content-section" style={{ gridColumn: "1 / -1" }}>
              <h3>NOTES</h3>
              <div style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>{notesText}</div>
            </div>
          </div>
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <a href="https://getvia.xyz/buyer.html" className="bottom-nav-link">
          Buyer
        </a>
        <a href="https://getvia.xyz/seller.html" className="bottom-nav-link">
          Seller
        </a>
        <a href="https://getvia.xyz/what-is-via.html" className="bottom-nav-link">
          FAQ
        </a>
        <a href="https://getvia.xyz/paper.html" className="bottom-nav-link">
          Paper
        </a>
        <a href="https://getvia.xyz/proof.html" className="bottom-nav-link">
          Proof
        </a>
        <a href="https://demo.getvia.xyz" className="bottom-nav-link">
          Demo
        </a>
        <a href="https://getvia.xyz/join.html" className="bottom-nav-link">
          Join
        </a>
      </nav>

      <div className="corner-left">© VIA Labs Pte Ltd</div>
      <div className="corner-right">
        <a href="https://x.com/via_labs_sg" target="_blank" rel="noopener noreferrer" className="social-link">
          <img src={xIconSrc} className="social-icon" alt="X" />
        </a>
      </div>
    </>
  );
}