import { existsSync, readFileSync } from 'node:fs';

function loadDotEnv(filename = '.env') {
  if (!existsSync(filename)) return;

  for (const line of readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function loadConfig(filename = 'config.json') {
  if (!existsSync(filename)) throw new Error('Missing ' + filename + '.');

  const config = JSON.parse(readFileSync(filename, 'utf8'));
  if (!Array.isArray(config.courses) || config.courses.length === 0) {
    throw new Error('config.json must contain a non-empty "courses" array.');
  }
  if (
    config.pollIntervalSeconds !== undefined &&
    (!Number.isFinite(config.pollIntervalSeconds) || config.pollIntervalSeconds <= 0)
  ) {
    throw new Error('pollIntervalSeconds must be a positive number.');
  }

  for (const course of config.courses) {
    if (!course.name || !course.url || !Array.isArray(course.slots) || !course.slots.length) {
      throw new Error('Every course needs name, url, and a non-empty slots array.');
    }
    if (course.slots.some((slot) => !slot.reference)) {
      throw new Error('Every configured slot needs its unique MyINL reference.');
    }
  }
  return config;
}

function cleanHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSlots(html) {
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
  return rows.map(([, row]) => {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const regSessionId = row.match(/name="reg_session_id"\s+value="(\d+)"/i)?.[1];

    return {
      location: cleanHtml(cells[0] ?? ''),
      schedule: cleanHtml(cells[1] ?? ''),
      reference: cleanHtml(cells[9] ?? ''),
      regSessionId,
      available: Boolean(regSessionId),
    };
  });
}

function responseMessage(html) {
  const alert = html.match(/<div class="alert[^>]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  return alert ? cleanHtml(alert) : null;
}

loadDotEnv();

const book = process.argv.includes('--book');
const watch = process.argv.includes('--watch') || book;
const sessionId = process.env.MYINL_SESSION_ID;
const timeZone = process.env.MYINL_TIMEZONE ?? 'Europe/Luxembourg';
const pushoverUserKey = process.env.PUSHOVER_USER_KEY;
const pushoverAppToken = process.env.PUSHOVER_APP_TOKEN;
const config = loadConfig();
const pollIntervalSeconds = config.pollIntervalSeconds ?? 5;
const pollIntervalMs = pollIntervalSeconds * 1000;

if (!sessionId) {
  console.error('Missing MYINL_SESSION_ID. Add it to .env.');
  process.exit(1);
}

const cookie = 'frontend_lang=en_US; tz=' + encodeURIComponent(timeZone) + '; session_id=' + sessionId;
const headers = {
  accept: 'text/html,application/xhtml+xml',
  'user-agent': 'myinl-slot-runner/1.0',
  cookie,
};

async function fetchPage(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error('Page request failed: HTTP ' + response.status);
  return response.text();
}

async function notifyPushover(title, message) {
  if (!pushoverUserKey || !pushoverAppToken) {
    console.warn('Pushover is not configured; skipping iPhone notification.');
    return;
  }

  const response = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: pushoverAppToken,
      user: pushoverUserKey,
      title,
      message,
    }),
  });
  const result = await response.json();
  if (!response.ok || result.status !== 1) {
    throw new Error(result.errors?.join(', ') ?? 'Pushover returned HTTP ' + response.status);
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findAvailableSlot() {
  let selected;

  for (const course of config.courses) {
    console.log('\n' + course.name);
    const html = await fetchPage(course.url);
    const csrfToken = html.match(/csrf_token:\s*"([^"]+)"/i)?.[1];
    const slots = parseSlots(html);

    for (const target of course.slots) {
      const result = slots.find((slot) => slot.reference === target.reference);
      const label = target.location + ' — ' + target.schedule;

      if (!result) {
        console.log('NOT FOUND  ' + label);
      } else if (result.available) {
        console.log('AVAILABLE  ' + label + ' (' + result.reference + ', ID ' + result.regSessionId + ')');
        if (!selected) selected = { course, csrfToken, slot: result };
      } else {
        console.log('SOLD OUT   ' + label + ' (' + result.reference + ')');
      }
    }
  }

  return selected;
}

let selected;
let attempt = 0;
do {
  attempt += 1;
  console.log('\n[' + new Date().toISOString() + '] Check #' + attempt);

  try {
    selected = await findAvailableSlot();
  } catch (error) {
    console.error('Check failed: ' + error.message);
    if (!watch) process.exit(1);
  }

  if (!selected && watch) {
    console.log('No preferred slot available. Retrying in ' + pollIntervalSeconds + ' seconds...');
    await sleep(pollIntervalMs);
  }
} while (!selected && watch);

if (!selected) {
  console.log('\nNo configured session is currently available; no enrollment request was sent.');
  process.exit(0);
}

const selectionLabel =
  selected.course.name + ': ' + selected.slot.location + ' — ' + selected.slot.schedule;
try {
  await notifyPushover('MyINL slot available', selectionLabel + ' (' + selected.slot.reference + ')');
  if (pushoverUserKey && pushoverAppToken) console.log('Sent Pushover availability notification.');
} catch (error) {
  console.error('Could not send Pushover notification: ' + error.message);
}

if (!book) {
  console.log('\nA preferred slot is available. Run npm run book to submit enrollment.');
  process.exit(0);
}

if (!selected.csrfToken) throw new Error('Could not find a CSRF token on ' + selected.course.name + '.');

console.log('\nBooking ' + selectionLabel);
const response = await fetch(selected.course.url, {
  method: 'POST',
  headers: {
    ...headers,
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'https://myinl.inll.lu',
    referer: selected.course.url,
  },
  body: new URLSearchParams({
    csrf_token: selected.csrfToken,
    reg_session_id: selected.slot.regSessionId,
  }),
});
const responseHtml = await response.text();

console.log('Enrollment request: HTTP ' + response.status);
const bookingMessage = responseMessage(responseHtml) ?? 'No server alert message was found in the response.';
console.log(bookingMessage);
try {
  await notifyPushover('MyINL booking response', selectionLabel + '\n' + bookingMessage);
  if (pushoverUserKey && pushoverAppToken) console.log('Sent Pushover booking-response notification.');
} catch (error) {
  console.error('Could not send Pushover notification: ' + error.message);
}
