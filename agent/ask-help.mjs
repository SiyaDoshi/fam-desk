// Path 3: a family member asks the agent to help Mom.
//   npm run ask-help -- +14155550123 "the Wi-Fi"
// 1. Saves the request, so the agent knows what the call is about when Mom calls.
// 2. Texts Mom (via Chert iMessage) inviting her to FaceTime the agent line when she's ready.
// The Chert SDK cannot receive replies yet, so Mom "says yes" by calling.
import { writeFileSync } from 'node:fs';
import { sendText } from './imessage.mjs';

export const REQUEST_FILE = new URL('./.help-request.json', import.meta.url);

const [phone, ...rest] = process.argv.slice(2);
const problem = rest.join(' ').trim();
if (!phone || !problem) {
  console.error('Usage: npm run ask-help -- <mom phone, e.g. +14155550123> "<problem, e.g. the Wi-Fi>"');
  process.exit(2);
}

const requester = process.env.FAMILY_NAME || 'Your family';
const line = process.env.AGENT_LINE_NUMBER || 'this number';
writeFileSync(REQUEST_FILE, JSON.stringify({ phone, problem, requester, at: new Date().toISOString() }, null, 2));

const body = `Hi! ${requester} asked me to help you with ${problem}. ` +
  `I'm an AI helper. Whenever you're ready, just FaceTime me at ${line} and point your camera at it. ` +
  `I'll walk you through it step by step.`;

console.log(`About to text ${phone}:\n  "${body}"`);
const result = await sendText(phone, body);
console.log(result.sent ? 'Queued. (Queued is not proof of delivery.)' : `Not sent: ${result.reason}`);
console.log('Saved the request. When Mom FaceTimes the line, the agent will know what it is about.');
