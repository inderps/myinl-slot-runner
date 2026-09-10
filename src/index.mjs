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

  for (const course of config.courses) {
    if (!course.name || !course.url || !Array.isArray(course.slots) || !course.slots.length) {
      throw new Error('Every course needs name, url, and a non-empty slots array.');
    }
  }
  return config;
}

function cleanHtml(value) {
  return value
    .replace(/<br\s*\/?/gi, ' ')
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
const sessionId = process.env.MYINL_SESSION_ID;
const timeZone = process.env.MYINL_TIMEZONE ?? 'Europe/Luxembourg';
const config = loadConfig();

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

let selected;

for (const course of config.courses) {
  console.log('\n' + course.name);
  const html = await fetchPage(course.url);
  const csrfToken = html.match(/csrf_token:\s*"([^"]+)"/i)?.[1];
  const slots = parseSlots(html);

  for (const target of course.slots) {
    const result = slots.find(
      (slot) => slot.location === target.location && slot.schedule === target.schedule,
    );
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

if (!book) {
  console.log('\nCheck only. Run npm run book to enroll in the first available configured slot.');
  process.exit(0);
}

if (!selected) {
  console.log('\nNo configured session is currently available; no enrollment request was sent.');
  process.exit(0);
}

if (!selected.csrfToken) throw new Error('Could not find a CSRF token on ' + selected.course.name + '.');

console.log('\nBooking ' + selected.course.name + ': ' + selected.slot.location + ' — ' + selected.slot.schedule);
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
console.log(responseMessage(responseHtml) ?? 'No server alert message was found in the response.');
