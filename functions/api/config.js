// GET /api/config
// Public config only. Never put SQUARE_ACCESS_TOKEN or any secret here, this
// response is readable by anyone who loads the seat page.

import { getSettings } from "../lib/settings.js";
import { listMenuItems } from "../lib/square.js";

// Falls back to this if Square's catalog can't be reached (not configured
// yet, API hiccup, whatever). Ordering should never break because of it.
const FALLBACK_MENU = [
  { id: "squash", name: "Squash", pricePence: 150 },
  { id: "crisps", name: "Crisps", pricePence: 150 },
  { id: "hotdog", name: "Hot Dog", pricePence: 400 },
];

export async function onRequestGet({ env }) {
  const settings = await getSettings(env.DB, [
    "tier_1_name", "tier_1_minutes", "tier_1_price_pence",
    "tier_2_name", "tier_2_minutes", "tier_2_price_pence",
    "tier_3_name", "tier_3_minutes", "tier_3_price_pence",
    "extension_minutes", "extension_price_pence",
  ]);

  let menu = FALLBACK_MENU;
  try {
    const catalogMenu = await listMenuItems(env);
    if (catalogMenu.length > 0) menu = catalogMenu;
  } catch (e) {
    console.error("Square catalog fetch failed, using fallback menu", e);
  }

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
  }, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
