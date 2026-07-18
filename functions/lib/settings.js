// Reads the settings table so tier names, prices, and timings can be changed
// from the database without a redeploy.

export async function getSettings(db, keys) {
  const placeholders = keys.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all();

  const out = {};
  for (const row of results) out[row.key] = row.value;
  return out;
}

export async function getTierConfig(db, tier) {
  const settings = await getSettings(db, [
    `${tier}_name`,
    `${tier}_minutes`,
    `${tier}_price_pence`,
  ]);
  return {
    name: settings[`${tier}_name`],
    minutes: Number(settings[`${tier}_minutes`]),
    pricePence: Number(settings[`${tier}_price_pence`]),
  };
}

export async function getExtensionConfig(db) {
  const settings = await getSettings(db, ["extension_minutes", "extension_price_pence"]);
  return {
    minutes: Number(settings.extension_minutes),
    pricePence: Number(settings.extension_price_pence),
  };
}
