
import crypto from "crypto";

export type Mode = "buyer" | "seller";

export type Category = "sneakers" | "outdoor" | "cycling" | "pet" | "other";

export type Offer = {
  id: string;
  sellerId: string;
  sellerName: string;

  headline: string;
  imageUrl: string;
  productUrl: string;

  // We keep these for later, but the UI will prefer priceTextOverride when present.
  pricePence: number;

  // IMPORTANT: allow multi-currency for demo (not locked to GBP).
  currency: string;

  // Merchant-provided price string (eg "$129", "€89", "AUD 199", etc).
  priceTextOverride?: string;

  deliveryDays: number;

  reliabilityLabel: "Verified" | "Reliable" | "New";
  replyClass: "fast" | "normal";
  arrivalDelayMs: number;

  sourceLabel: string;

  policy: {
    minPricePence: number;
    canUpgradeDelivery: boolean;
    upgradeFeePence: number;
    maxDiscountPence: number;
  };
};

export type ThreadEvent = {
  id: string;
  ts: string;
  who: "You" | "Your assistant" | "Seller assistant";
  text: string;
};

export type InternalThread = {
  v: 1;
  threadId: string;
  createdAt: string;
  mode: Mode;

  requestText: string;
  category: Category;

  status: "COLLECTING_OFFERS" | "OFFER_SELECTED" | "AGREED" | "COMPLETED";
  selectedOfferId: string | null;

  offers: Offer[];
  events: ThreadEvent[];

  terms: {
    pricePence: number | null;
    deliveryDays: number | null;
    notes: string[];
  };

  confirmed: boolean;
};

export function secret(): string {
  const s = process.env.DEMO_TOKEN_SECRET;
  if (!s || s.length < 16) return "dev_secret_change_me_please_1234567890";
  return s;
}

function hmac(input: string): string {
  return crypto.createHmac("sha256", secret()).update(input).digest("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function encodeToken(obj: any): string {
  const json = JSON.stringify(obj);
  const payload = Buffer.from(json, "utf8").toString("base64url");
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

export function decodeToken<T>(token: string): T {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Bad token");
  const [payload, sig] = parts;
  const expected = hmac(payload);
  if (!timingSafeEqual(sig, expected)) throw new Error("Bad token signature");
  const json = Buffer.from(payload, "base64url").toString("utf8");
  return JSON.parse(json) as T;
}

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function toPriceText(pence: number, currency: string): string {
  const v = (pence / 100).toFixed(0);

  // simple symbol mapping for later use if needed
  const c = (currency || "").toUpperCase();
  if (c === "GBP") return `£${v}`;
  if (c === "USD") return `$${v}`;
  if (c === "EUR") return `€${v}`;

  return `${c} ${v}`.trim();
}

function deliveryText(days: number): string {
  if (days <= 1) return "Delivery: next day";
  if (days === 2) return "Delivery: 2 days";
  return `Delivery: ${days} days`;
}

function containsAny(s: string, needles: string[]): boolean {
  const x = s.toLowerCase();
  return needles.some(n => x.includes(n));
}

export function classifyIntent(requestText: string): Category {
  const t = requestText.toLowerCase();

  if (containsAny(t, ["sneaker", "trainers", "running shoe", "air max", "dunk", "jordans", "nike", "adidas", "new balance", "asics"])) {
    return "sneakers";
  }

  if (containsAny(t, ["hike", "hiking", "trail", "waterproof", "gore", "camp", "camping", "tent", "backpack", "rucksack", "outdoor", "jacket", "boots"])) {
    return "outdoor";
  }

  if (containsAny(t, ["cycle", "cycling", "bike", "bicycle", "mtb", "road bike", "jersey", "bib", "helmet", "cleats", "shimano", "sram"])) {
    return "cycling";
  }

  if (containsAny(t, ["pet", "dog", "cat", "kitten", "puppy", "leash", "collar", "litter", "kibble", "treats", "groom", "toy"])) {
    return "pet";
  }

  return "other";
}

function categoryLabel(c: Category): string {
  if (c === "sneakers") return "Sneakers";
  if (c === "outdoor") return "Outdoor";
  if (c === "cycling") return "Cycling";
  if (c === "pet") return "Pet supplies";
  return "General";
}

function placeholderImage(category: Category, seed: string): string {
  const text = encodeURIComponent(categoryLabel(category));
  return `https://placehold.co/600x400/png?text=${text}%20${encodeURIComponent(seed)}`;
}

function makeOffersForCategory(category: Category): Offer[] {
  const baseSource = "Live pricing, curated sellers";
  const common = { currency: "GBP" };

  if (category === "sneakers") {
    return [
      {
        id: id("o"),
        sellerId: "seller_alpha",
        sellerName: "City Kicks",
        headline: "Runner Court Low (white)",
        imageUrl: placeholderImage(category, "01"),
        productUrl: "#",
        pricePence: 12500,
        currency: common.currency,
        deliveryDays: 2,
        reliabilityLabel: "Reliable",
        replyClass: "fast",
        arrivalDelayMs: 700,
        sourceLabel: baseSource,
        policy: { minPricePence: 11800, canUpgradeDelivery: true, upgradeFeePence: 600, maxDiscountPence: 700 }
      },
      {
        id: id("o"),
        sellerId: "seller_drhobbs",
        sellerName: "DrHobbs Store",
        headline: "Street Mono Trainer (black)",
        imageUrl: placeholderImage(category, "02"),
        productUrl: "#",
        pricePence: 13900,
        currency: common.currency,
        deliveryDays: 3,
        reliabilityLabel: "Verified",
        replyClass: "normal",
        arrivalDelayMs: 1400,
        sourceLabel: baseSource,
        policy: { minPricePence: 13200, canUpgradeDelivery: true, upgradeFeePence: 500, maxDiscountPence: 800 }
      },
      {
        id: id("o"),
        sellerId: "seller_peak",
        sellerName: "Archive Sports",
        headline: "Retro Mesh Runner (silver)",
        imageUrl: placeholderImage(category, "03"),
        productUrl: "#",
        pricePence: 11900,
        currency: common.currency,
        deliveryDays: 4,
        reliabilityLabel: "New",
        replyClass: "normal",
        arrivalDelayMs: 2200,
        sourceLabel: baseSource,
        policy: { minPricePence: 11200, canUpgradeDelivery: false, upgradeFeePence: 0, maxDiscountPence: 600 }
      }
    ];
  }

  if (category === "cycling") {
    return [
      {
        id: id("o"),
        sellerId: "seller_alpha",
        sellerName: "Peloton Supply",
        headline: "Road Jersey, breathable",
        imageUrl: placeholderImage(category, "01"),
        productUrl: "#",
        pricePence: 8900,
        currency: common.currency,
        deliveryDays: 2,
        reliabilityLabel: "Reliable",
        replyClass: "fast",
        arrivalDelayMs: 800,
        sourceLabel: baseSource,
        policy: { minPricePence: 8200, canUpgradeDelivery: true, upgradeFeePence: 450, maxDiscountPence: 500 }
      },
      {
        id: id("o"),
        sellerId: "seller_drhobbs",
        sellerName: "DrHobbs Store",
        headline: "Bib shorts, endurance fit",
        imageUrl: placeholderImage(category, "02"),
        productUrl: "#",
        pricePence: 12900,
        currency: common.currency,
        deliveryDays: 3,
        reliabilityLabel: "Verified",
        replyClass: "normal",
        arrivalDelayMs: 1500,
        sourceLabel: baseSource,
        policy: { minPricePence: 12000, canUpgradeDelivery: true, upgradeFeePence: 500, maxDiscountPence: 700 }
      },
      {
        id: id("o"),
        sellerId: "seller_peak",
        sellerName: "Chainline Co",
        headline: "Helmet, commuter safe",
        imageUrl: placeholderImage(category, "03"),
        productUrl: "#",
        pricePence: 7400,
        currency: common.currency,
        deliveryDays: 4,
        reliabilityLabel: "New",
        replyClass: "normal",
        arrivalDelayMs: 2300,
        sourceLabel: baseSource,
        policy: { minPricePence: 7000, canUpgradeDelivery: false, upgradeFeePence: 0, maxDiscountPence: 400 }
      }
    ];
  }

  if (category === "pet") {
    return [
      {
        id: id("o"),
        sellerId: "seller_alpha",
        sellerName: "Happy Paws",
        headline: "Dog treats, grain free",
        imageUrl: placeholderImage(category, "01"),
        productUrl: "#",
        pricePence: 1900,
        currency: common.currency,
        deliveryDays: 2,
        reliabilityLabel: "Reliable",
        replyClass: "fast",
        arrivalDelayMs: 700,
        sourceLabel: baseSource,
        policy: { minPricePence: 1700, canUpgradeDelivery: true, upgradeFeePence: 200, maxDiscountPence: 200 }
      },
      {
        id: id("o"),
        sellerId: "seller_drhobbs",
        sellerName: "DrHobbs Store",
        headline: "Leash and collar set",
        imageUrl: placeholderImage(category, "02"),
        productUrl: "#",
        pricePence: 3200,
        currency: common.currency,
        deliveryDays: 3,
        reliabilityLabel: "Verified",
        replyClass: "normal",
        arrivalDelayMs: 1500,
        sourceLabel: baseSource,
        policy: { minPricePence: 2900, canUpgradeDelivery: true, upgradeFeePence: 250, maxDiscountPence: 300 }
      },
      {
        id: id("o"),
        sellerId: "seller_peak",
        sellerName: "Cat Corner",
        headline: "Cat toy bundle",
        imageUrl: placeholderImage(category, "03"),
        productUrl: "#",
        pricePence: 1600,
        currency: common.currency,
        deliveryDays: 4,
        reliabilityLabel: "New",
        replyClass: "normal",
        arrivalDelayMs: 2400,
        sourceLabel: baseSource,
        policy: { minPricePence: 1500, canUpgradeDelivery: false, upgradeFeePence: 0, maxDiscountPence: 100 }
      }
    ];
  }

  return [
    {
      id: id("o"),
      sellerId: "seller_alpha",
      sellerName: "Trail Supply",
      headline: "Waterproof daypack (20L)",
      imageUrl: placeholderImage("outdoor", "01"),
      productUrl: "#",
      pricePence: 7900,
      currency: "GBP",
      deliveryDays: 3,
      reliabilityLabel: "Reliable",
      replyClass: "fast",
      arrivalDelayMs: 800,
      sourceLabel: baseSource,
      policy: { minPricePence: 7400, canUpgradeDelivery: true, upgradeFeePence: 500, maxDiscountPence: 500 }
    },
    {
      id: id("o"),
      sellerId: "seller_drhobbs",
      sellerName: "DrHobbs Store",
      headline: "All-weather shell jacket",
      imageUrl: placeholderImage("outdoor", "02"),
      productUrl: "#",
      pricePence: 14900,
      currency: "GBP",
      deliveryDays: 2,
      reliabilityLabel: "Verified",
      replyClass: "normal",
      arrivalDelayMs: 1400,
      sourceLabel: baseSource,
      policy: { minPricePence: 14000, canUpgradeDelivery: true, upgradeFeePence: 600, maxDiscountPence: 800 }
    },
    {
      id: id("o"),
      sellerId: "seller_peak",
      sellerName: "Peak Outfitters",
      headline: "Trail boots, rugged sole",
      imageUrl: placeholderImage("outdoor", "03"),
      productUrl: "#",
      pricePence: 13900,
      currency: "GBP",
      deliveryDays: 4,
      reliabilityLabel: "New",
      replyClass: "normal",
      arrivalDelayMs: 2100,
      sourceLabel: baseSource,
      policy: { minPricePence: 13200, canUpgradeDelivery: false, upgradeFeePence: 0, maxDiscountPence: 600 }
    }
  ];
}

export function visibleOffers(t: InternalThread, now: Date): Offer[] {
  const created = new Date(t.createdAt).getTime();
  const elapsed = now.getTime() - created;
  return t.offers
    .filter(o => elapsed >= o.arrivalDelayMs)
    .sort((a, b) => a.arrivalDelayMs - b.arrivalDelayMs);
}

export function uiOffer(o: Offer) {
  return {
    id: o.id,
    sellerName: o.sellerName,
    headline: o.headline,
    imageUrl: o.imageUrl,
    productUrl: o.productUrl,
    sourceLabel: o.sourceLabel,
    priceText: o.priceTextOverride && o.priceTextOverride.trim()
      ? o.priceTextOverride
      : toPriceText(o.pricePence, o.currency),
    deliveryText: deliveryText(o.deliveryDays),
    reliabilityLabel: o.reliabilityLabel,
    fastReplyLabel: o.replyClass === "fast" ? "Replies fast" : "Normal reply"
  };
}

export function kpis(t: InternalThread, now: Date) {
  const elapsedSeconds = (now.getTime() - new Date(t.createdAt).getTime()) / 1000;
  let stageLabel = "Collecting offers";
  if (t.status === "OFFER_SELECTED") stageLabel = "Conversation opened";
  if (t.status === "AGREED") stageLabel = "Ready to confirm";
  if (t.status === "COMPLETED") stageLabel = "Completed";

  const offersCount = visibleOffers(t, now).length;

  return {
    elapsedSeconds: elapsedSeconds > 0 ? elapsedSeconds : 0,
    offersCount,
    stageLabel,
    confirmed: t.confirmed,
    category: categoryLabel(t.category)
  };
}

export function toUI(t: InternalThread, now: Date) {
  const offers = visibleOffers(t, now).map(uiOffer);
  return {
    threadId: t.threadId,
    status: t.status,
    requestText: t.requestText,
    selectedOfferId: t.selectedOfferId,
    offers,
    events: t.events,
    kpis: kpis(t, now)
  };
}

export function makeInitialThread(requestText: string, mode: Mode): InternalThread {
  const threadId = id("t");
  const createdAt = new Date().toISOString();
  const category = classifyIntent(requestText);

  const offers = makeOffersForCategory(category);

  const events: ThreadEvent[] = [
    { id: id("e"), ts: createdAt, who: "You", text: requestText.trim() },
    {
      id: id("e"),
      ts: createdAt,
      who: "Your assistant",
      text: "Got it. I’m collecting offers from participating sellers now."
    }
  ];

  return {
    v: 1,
    threadId,
    createdAt,
    mode,
    requestText: requestText.trim(),
    category,
    status: "COLLECTING_OFFERS",
    selectedOfferId: null,
    offers,
    events,
    terms: { pricePence: null, deliveryDays: null, notes: [] },
    confirmed: false
  };
}

export function selectOfferInThread(t: InternalThread, offerId: string): InternalThread {
  const offer = t.offers.find(o => o.id === offerId);
  if (!offer) return t;

  const now = new Date().toISOString();
  const events = [...t.events];

  events.push({
    id: id("e"),
    ts: now,
    who: "Your assistant",
    text: `I’ll speak to ${offer.sellerName} based on this offer and come back with agreed terms.`
  });

  events.push({
    id: id("e"),
    ts: now,
    who: "Seller assistant",
    text: "Thanks. I can confirm availability. Tell me if you want delivery changes or price adjustments."
  });

  return {
    ...t,
    status: "OFFER_SELECTED",
    selectedOfferId: offerId,
    events,
    terms: { pricePence: offer.pricePence, deliveryDays: offer.deliveryDays, notes: [] }
  };
}

export function buyerMessage(t: InternalThread, text: string): InternalThread {
  const offer = t.selectedOfferId ? t.offers.find(o => o.id === t.selectedOfferId) : null;
  const nowIso = new Date().toISOString();
  const events = [...t.events];

  events.push({ id: id("e"), ts: nowIso, who: "You", text: text.trim() });

  if (!offer) {
    events.push({
      id: id("e"),
      ts: nowIso,
      who: "Your assistant",
      text: "Pick an offer first, then I can negotiate with that seller."
    });
    return { ...t, events };
  }

  let price = t.terms.pricePence ?? offer.pricePence;
  let delivery = t.terms.deliveryDays ?? offer.deliveryDays;
  const notes = [...t.terms.notes];

  const wantsFaster = containsAny(text, ["next day", "tomorrow", "express", "fast delivery", "overnight"]);
  const wantsDiscount = containsAny(text, ["discount", "cheaper", "best price", "lower", "reduce", "deal", "%"]);

  let sellerReply = "";

  if (wantsFaster) {
    if (offer.policy.canUpgradeDelivery && delivery > 1) {
      delivery = Math.max(1, delivery - 1);
      price = price + offer.policy.upgradeFeePence;
      notes.push("Delivery upgraded");
      sellerReply = `I can upgrade delivery. Updated terms: ${toPriceText(price, offer.currency)} with ${deliveryText(delivery)}.`;
    } else {
      sellerReply = `I can’t upgrade delivery on this one. Current terms remain: ${toPriceText(price, offer.currency)} with ${deliveryText(delivery)}.`;
    }
  } else if (wantsDiscount) {
    const target = Math.max(offer.policy.minPricePence, price - offer.policy.maxDiscountPence);
    if (target < price) {
      price = target;
      notes.push("Price adjusted");
      sellerReply = `I can improve the price slightly. Updated terms: ${toPriceText(price, offer.currency)} with ${deliveryText(delivery)}.`;
    } else {
      sellerReply = `I’m already at the best price I can do for this. Current terms: ${toPriceText(price, offer.currency)} with ${deliveryText(delivery)}.`;
    }
  } else {
    sellerReply = `Understood. Current terms are ${toPriceText(price, offer.currency)} with ${deliveryText(delivery)}. Ask for delivery speed or price if you want changes.`;
  }

  events.push({ id: id("e"), ts: nowIso, who: "Seller assistant", text: sellerReply });

  return {
    ...t,
    status: "AGREED",
    events,
    terms: { pricePence: price, deliveryDays: delivery, notes }
  };
}

export function confirmThread(t: InternalThread): InternalThread {
  const nowIso = new Date().toISOString();
  const events = [...t.events];

  if (t.status !== "AGREED") {
    events.push({
      id: id("e"),
      ts: nowIso,
      who: "Your assistant",
      text: "We need clear agreed terms first. Ask a follow-up, then confirm."
    });
    return { ...t, events };
  }

  events.push({
    id: id("e"),
    ts: nowIso,
    who: "Your assistant",
    text: "Confirmed. Order placed and instantly acknowledged by the seller."
  });

  events.push({
    id: id("e"),
    ts: nowIso,
    who: "Seller assistant",
    text: "Confirmed on my side. I’ll send tracking as soon as it ships."
  });

  return { ...t, status: "COMPLETED", confirmed: true, events };
}
