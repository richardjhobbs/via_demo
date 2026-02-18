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
  debug?: any;
};

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("via_demo_theme");
  if (saved === "dark" || saved === "light") return saved;
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  if (theme === "dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
}

export default function HomePage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [rightTab, setRightTab] = useState<"offers" | "transparency" | "debug">("offers");

  const [requestText, setRequestText] = useState("");
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pollOn, setPollOn] = useState(false);

  // Set your real X URL here (do not guess)
  const xUrl = "https://x.com/via_labs_sg";

  const heroSubtitle = useMemo(() => {
    return "Live agent-to-agent commerce demo. Intent is interpreted, broadcast to merchants, responses arrive, negotiation happens, you confirm. See all NOTES below!";
  }, []);

  const notesText = useMemo(() => {
    return (
      "This is a visualization of part of what happens behind the scenes when agentic commerce takes place. " +
      "It shows intent being distributed, and merchant agents (these are actual retail operators) offering products " +
      "through the MCP server and NOSTR relay constructed as part of the VIA protocol.\n\n" +
      "For the purposes of this demo, merchants and categories are restricted to:\n" +
      "SNEAKERS\nOUTDOORS\nCYCLING\nPET SUPPLIES\n\n" +
      "There are no pricing parameters. Feel free to test and see the process at work."
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
    setRequestText("");
    setThread(null);
    setPollOn(false);
    setRightTab("offers");
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
        body: JSON.stringify({ requestText: txt })
      });

      if (!res.ok) throw new Error("Failed to start demo");
      const data = await res.json();
      setThread(data);
      setPollOn(true);
      setRightTab("offers");
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
      const data = await res.json();
      setThread(data);
      setRightTab("transparency");
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

  const intentLine =
    thread?.kpis?.category
      ? `Detected category: ${thread.kpis.category}`
      : "Detected category: pending";

  const routingLine =
    thread?.kpis?.category
      ? `Broadcasting into ${thread.kpis.category} stores.`
      : "Broadcasting into participating stores.";

  const timeline = useMemo(() => {
    const stage = thread?.kpis?.stageLabel?.toLowerCase() ?? "";
    const offersCount = thread?.kpis?.offersCount ?? 0;
    const hasOfferSelected = Boolean(thread?.selectedOfferId);
    const confirmed = Boolean(thread?.kpis?.confirmed);

    const stepStatus = (n: number) => {
      if (!thread) return "Pending";
      if (confirmed) return "Done";
      if (n === 1) return "Done";
      if (n === 2) return stage.includes("broadcast") || offersCount > 0 ? "Active" : "Pending";
      if (n === 3) return offersCount > 0 ? (offersCount >= 3 ? "Done" : "Active") : "Pending";
      if (n === 4) return hasOfferSelected ? "Active" : "Pending";
      if (n === 5) return thread.status === "AGREED" ? "Active" : "Pending";
      return "Pending";
    };

    return [
      { n: 1, title: "Interpret intent", desc: thread ? intentLine : "Waiting for your request.", status: stepStatus(1) },
      { n: 2, title: "Broadcast to merchants", desc: thread ? routingLine : "Waiting.", status: stepStatus(2) },
      { n: 3, title: "Collect responses", desc: thread ? `${offersCount} offer(s) received.` : "Waiting.", status: stepStatus(3) },
      { n: 4, title: "Negotiate", desc: thread ? (thread.selectedOfferId ? "Negotiation open on selected offer." : "Select an offer to begin.") : "Select an offer to begin.", status: stepStatus(4) },
      { n: 5, title: "Confirm", desc: thread ? (thread.kpis.confirmed ? "Confirmed." : "Final step always requires buyer approval.") : "Final step always requires buyer approval.", status: stepStatus(5) }
    ];
  }, [thread, intentLine, routingLine]);

  const viaLogoSrc = theme === "dark" ? "/images/VIA_logo_large_white.png" : "/images/VIA_logo_large_black.png";
  const xIconSrc = theme === "dark" ? "/images/logo-white.png" : "/images/logo-black.png";

  return (
    <>
      {/* Uses the same structural hooks as getvia CSS */}
      <header>
        <a href="https://getvia.xyz/index.html" className="logo" aria-label="VIA Home">

          <img id="logo" src={viaLogoSrc} alt="VIA Logo" />
        </a>
      </header>

      <button className="theme-toggle" aria-label="Toggle dark/light mode" onClick={toggleTheme}>
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

      {/* main is required for proper centering in your CSS */}
      <main>
        <div className="container">
          <h1>VIA DEMO</h1>
          <p className="subtitle">{heroSubtitle}</p>

          <div className="demo-split" style={{ marginTop: 18 }}>
            {/* LEFT COLUMN */}
            <div className="card">
              <div className="demo-section-title">
                <h2>Intent</h2>
                <span className="demo-smalllink" onClick={resetAll}>Reset</span>
              </div>

              <p style={{ marginTop: 10 }}>
                Describe what you want. The assistant interprets intent, broadcasts to multiple merchants, collects responses, negotiates, and you approve the final step.
              </p>

              <div style={{ marginTop: 12 }}>
                <textarea
                  value={requestText}
                  onChange={(e) => setRequestText(e.target.value)}
                  placeholder={'Try: "Cycling helmet size M, breathable"\nOr: "Dog treats, grain free, deliver this week"'}
                  rows={6}
                  style={{ width: "100%", resize: "vertical" }}
                />

                <div style={{ marginTop: 10 }}>
                  <button
                    className="cta-button"
                    disabled={loading || requestText.trim().length === 0}
                    onClick={createThread}
                    style={{ width: "100%" }}
                  >
                    {loading ? "Working..." : "Send request"}
                  </button>
                </div>
              </div>

              <div style={{ height: 16 }} />

              <div className="content-section">
                <h3>Orchestration</h3>
                <p><b>Current phase:</b> {thread ? thread.kpis.stageLabel : "Waiting for request"}</p>
                <p style={{ opacity: 0.8 }}>
                  This is a live demo pulling real data from real stores to show agent coordination.
                </p>
              </div>

              <div className="content-section">
                <h3>Timeline</h3>
                {timeline.map((s) => (
                  <div className="demo-item" key={s.n}>
                    <div className="demo-meta">
                      <span>{s.n}. {s.title}</span>
                      <span>{s.status}</span>
                    </div>
                    <div className="demo-text">{s.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="card">
              {rightTab === "offers" && (
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

                  {thread && thread.offers.map((o) => (
                    <div className="demo-offer" key={o.id}>
                      <div className="demo-offer-top">
                        <img className="demo-offer-img" src={o.imageUrl} alt={o.headline} />
                        <div style={{ flex: 1 }}>
                          <div className="demo-offer-title">{o.headline}</div>
                          <div className="demo-muted">{o.priceText} , {o.deliveryText}</div>

                          <div className="demo-badges">
                            <span className={"demo-badge " + (o.reliabilityLabel === "Verified" ? "good" : "")}>
                              {o.reliabilityLabel}
                            </span>
                            <span className="demo-badge">{o.fastReplyLabel}</span>
                            <span className="demo-badge">{o.sellerName}</span>
                            <span className="demo-badge">{o.sourceLabel}</span>
                          </div>

                          <div style={{ marginTop: 10 }}>
                            <a href={o.productUrl} target="_blank" rel="noreferrer">View product</a>
                          </div>
                        </div>
                      </div>

                      <button className="cta-button" onClick={() => selectOffer(o.id)} disabled={loading || thread.kpis.confirmed}>
                        {thread.selectedOfferId === o.id ? "Selected" : "Select and negotiate"}
                      </button>
                    </div>
                  ))}
                </>
              )}

              {rightTab === "transparency" && (
                <>
                  <div className="demo-section-title">
                    <h2>Transparency</h2>
                    <span className="demo-smalllink">What the agent is doing</span>
                  </div>

                  {!thread && (
                    <div className="demo-item">
                      <div className="demo-meta"><span>Not started</span><span>Waiting</span></div>
                      <div className="demo-text">Send a request first.</div>
                    </div>
                  )}

                  {thread && (
                    <>
                      <div className="demo-item">
                        <div className="demo-meta"><span>Intent</span><span>{thread.kpis.category ?? "pending"}</span></div>
                        <div className="demo-text">Request is classified, then broadcast to multiple merchants in the matched category.</div>
                      </div>

                      <div className="demo-item">
                        <div className="demo-meta"><span>Responses</span><span>{thread.kpis.offersCount}/3</span></div>
                        <div className="demo-text">Merchant responses are normalised into comparable offer objects.</div>
                      </div>

                      <div className="demo-item">
                        <div className="demo-meta"><span>Negotiation</span><span>{thread.selectedOfferId ? "Open" : "Not started"}</span></div>
                        <div className="demo-text">
                          {thread.selectedOfferId
                            ? "One offer is selected. Messages now target that merchant thread until you confirm."
                            : "Select an offer to begin negotiation."}
                        </div>
                      </div>

                      <div className="demo-item">
                        <div className="demo-meta"><span>Confirmation</span><span>{thread.kpis.confirmed ? "Confirmed" : "Pending"}</span></div>
                        <div className="demo-text">Final step always requires explicit buyer approval.</div>
                      </div>
                    </>
                  )}
                </>
              )}

              {rightTab === "debug" && (
                <>
                  <div className="demo-section-title">
                    <h2>Debug</h2>
                    <span className="demo-smalllink">Raw diagnostics</span>
                  </div>

                  {!thread && (
                    <div className="demo-item">
                      <div className="demo-meta"><span>No data</span><span>Waiting</span></div>
                      <div className="demo-text">Start a request to see diagnostics.</div>
                    </div>
                  )}

                  {thread && (
                    <div className="demo-item">
                      <div className="demo-meta"><span>Thread</span><span>{thread.threadId}</span></div>
                      <div className="demo-text" style={{ whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(
                          {
                            status: thread.status,
                            kpis: thread.kpis,
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

              {/* Buttons at the bottom of the right Offers column */}
              <div style={{ marginTop: 16 }}>
                <div className="demo-controls" style={{ justifyContent: "center" }}>
                  <button
                    className={"demo-pill " + (rightTab === "offers" ? "active" : "")}
                    onClick={() => setRightTab("offers")}
                  >
                    Offers
                  </button>
                  <button
                    className={"demo-pill " + (rightTab === "transparency" ? "active" : "")}
                    onClick={() => setRightTab("transparency")}
                  >
                    Transparency
                  </button>
                  <button
                    className={"demo-pill " + (rightTab === "debug" ? "active" : "")}
                    onClick={() => setRightTab("debug")}
                  >
                    Debug
                  </button>
                </div>
              </div>
            </div>

            {/* Conversation full width */}
            <div className="card" style={{ gridColumn: "1 / -1" }}>
              <div className="demo-section-title">
                <h2>Conversation</h2>
                <span className="demo-smalllink">{thread ? `Status: ${thread.status}` : "Not started"}</span>
              </div>

              {!thread && (
                <div className="demo-item">
                  <div className="demo-meta"><span>Waiting</span><span>Send a request</span></div>
                  <div className="demo-text">Send a request to see the agent coordination thread.</div>
                </div>
              )}

              {thread && thread.events.map((e) => (
                <div className="demo-item" key={e.id}>
                  <div className="demo-meta">
                    <span>{e.who}</span>
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
              )}
            </div>

            {/* NOTES full width */}
            <div className="content-section" style={{ gridColumn: "1 / -1" }}>
              <h3>NOTES</h3>
              <div style={{ whiteSpace: "pre-wrap", opacity: 0.9 }}>
                {notesText}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer uses the same classes as getvia */}
      <div className="footer-left">© VIA Labs Pte Ltd</div>
      <div className="footer-right">
        <a href={xUrl} target="_blank" rel="noopener noreferrer" className="social-link" aria-label="VIA on X">
          <img
            id="socialIcon"
            src={xIconSrc}
            alt="X (Twitter)"
            className="social-icon"
          />
        </a>
      </div>
    </>
  );
}
