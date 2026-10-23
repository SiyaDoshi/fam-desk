// Sending iMessages through Chert (optional).
// Needs CHERT_BASE_URL and CHERT_API_KEY in .env.local (from the Chert dashboard,
// Developer page). Without them, messages are printed to the log instead of sent.
// Note: the Chert SDK can only SEND iMessages today; it cannot receive replies.
import { randomUUID } from 'node:crypto';
import { ChertClient } from '@trychert/sdk/imessage';

const configured = Boolean(process.env.CHERT_BASE_URL && process.env.CHERT_API_KEY);
const client = configured
  ? new ChertClient({ baseURL: process.env.CHERT_BASE_URL, apiKey: process.env.CHERT_API_KEY })
  : null;

/** Send `body` to `phone` (E.164, e.g. +14155550123). Returns { sent, receipt?, reason? }. */
export async function sendText(phone, body, idempotencyKey = randomUUID()) {
  if (!phone) return { sent: false, reason: 'no phone number configured' };
  if (!client) {
    console.log(`[imessage:not-configured] to ${phone}: ${body}`);
    return { sent: false, reason: 'CHERT_BASE_URL / CHERT_API_KEY not set; message logged only' };
  }
  try {
    const receipt = await client.sendText({ phone, body, idempotency_key: idempotencyKey });
    console.log(`[imessage] queued to ${phone} (${receipt.message_id})`);  // queued, not proof of delivery
    return { sent: true, receipt };
  } catch (err) {
    console.warn(`[imessage] send failed: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}
