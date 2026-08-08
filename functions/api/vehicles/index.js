// GET /api/vehicles
// Public. Powers the tap-to-pick model grid on both the QR walk-in flow
// (/start, /seat) and the pre-booking form (/book), plus the staff
// dashboard's redeem screen. Returns the full active catalog with a
// "right now" available count per model.
//
// "Available now" is a live, walk-in-facing number, not a promise for a
// future date/time. A booking for next Saturday checks its own slot's
// availability server-side at submit (see /api/bookings), it doesn't
// read this endpoint, since "available now" and "available at 2pm on
// the 14th" are two different questions.

import { getVehicleAvailabilityNow } from "../../lib/capacity.js";

export async function onRequestGet({ env }) {
  const data = await getVehicleAvailabilityNow(env.DB);
  return Response.json(data);
}
