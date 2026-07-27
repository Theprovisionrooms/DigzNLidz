// GET /api/config
// Public config only. Never put SQUARE_ACCESS_TOKEN or any secret here, this
// response is readable by anyone who loads the seat page.

import { getSettings } from "../lib/settings.js";
import { getMenu } from "../lib/square.js";

// Confirmed by Jordan. Keyed by JS Date.getDay(): 0 Sun, 1 Mon ... 6 Sat.
// Monday and Tuesday aren't listed here at all, meaning closed.
export const BUSINESS_HOURS = {
  0: { open: "11:00", close: "18:00" }, // Sunday
  3: { open: "11:00", close: "18:00" }, // Wednesday
  4: { open: "11:00", close: "18:00" }, // Thursday
  5: { open: "11:00", close: "20:00" }, // Friday
  6: { open: "11:00", close: "20:00" }, // Saturday
};

export async function onRequestGet({ env }) {
  const settings = await getSettings(env.DB, [
    "tier_1_name", "tier_1_minutes", "tier_1_price_pence",
    "tier_2_name", "tier_2_minutes", "tier_2_price_pence",
    "tier_3_name", "tier_3_minutes", "tier_3_price_pence",
    "extension_minutes", "extension_price_pence",
  ]);

  // Same source seats/[id]/order.js and tables/[id]/order.js re-price
  // against, so what's shown here always matches what can actually be
  // charged.
  const menu = await getMenu(env);

  return Response.json({
    squareApplicationId: env.SQUARE_APPLICATION_ID,
    squareLocationId: env.SQUARE_LOCATION_ID_PUBLIC,
    squareEnv: env.SQUARE_ENV || "sandbox",
    tiers: {
      tier_1: { name: settings.tier_1_name, minutes: Number(settings.tier_1_minutes), pricePence: Number(settings.tier_1_price_pence) },
      tier_2: { name: settings.tier_2_name, minutes: Number(settings.tier_2_minutes), pricePence: Number(settings.tier_2_price_pence) },
      tier_3: { name: settings.tier_3_name, minutes: Number(settings.tier_3_minutes), pricePence: Number(settings.tier_3_price_pence) },
    },
    extension: {
      minutes: Number(settings.extension_minutes),
      pricePence: Number(settings.extension_price_pence),
    },
    menu,
    hours: BUSINESS_HOURS,
  }, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
