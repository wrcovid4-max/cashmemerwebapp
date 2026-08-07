/**
 * The lock screen.
 *
 * Two jobs in one page:
 *   - the very first time, there is no passcode yet, so it asks you to choose
 *     one (twice, so a typo cannot lock you out of your own till)
 *   - every time after that, it asks for it
 *
 * It is deliberately plain JavaScript with no imports beyond the API helper:
 * this is the one page that has to work even when everything else is locked.
 */

const els = {
  form: document.getElementById('form'),
  heading: document.getElementById('heading'),
  why: document.getElementById('why'),
  label: document.getElementById('label'),
  passcode: document.getElementById('passcode'),
  confirmField: document.getElementById('confirmField'),
  confirm: document.getElementById('confirm'),
  message: document.getElementById('message'),
  submit: document.getElementById('submit'),
  tagline: document.getElementById('tagline'),
  footnote: document.getElementById('footnote'),
};

/** Where to land after signing in. Only ever a path on this app. */
function nextUrl() {
  const raw = new URLSearchParams(location.search).get('next') ?? '/';
  // An open redirect would let someone send you somewhere else entirely, so
  // anything that is not a plain path on this server is ignored.
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

let firstRun = false;

function say(text, kind = 'error') {
  els.message.innerHTML = '';
  if (!text) return;
  const box = document.createElement('div');
  box.className = `notice ${kind}`;
  const inner = document.createElement('div');
  inner.className = 'grow small';
  inner.textContent = text;
  box.append(inner);
  els.message.append(box);
}

async function loadState() {
  try {
    const state = await fetch('/api/auth/state').then((r) => r.json());

    if (state.signedIn) {
      location.replace(nextUrl());
      return;
    }

    firstRun = !state.hasPasscode;

    if (firstRun) {
      els.tagline.textContent = 'First run';
      els.heading.textContent = 'Choose a passcode';
      els.why.textContent =
        'Cash Memer is served to your whole Wi-Fi so your phone can reach it. ' +
        'That means anyone else on the network can too. Pick something only you know.';
      els.label.textContent = 'New passcode';
      els.passcode.placeholder = 'at least 4 characters';
      els.passcode.setAttribute('autocomplete', 'new-password');
      els.confirmField.classList.remove('hidden');
      els.submit.textContent = 'Set passcode and open';
      els.footnote.textContent =
        'Write it down somewhere safe. Nobody can recover it for you — losing it means ' +
        'deleting data/cashmemer.db and starting again.';
    } else {
      els.footnote.textContent =
        'Asked once per device. Your phone will not be asked again for 30 days.';
    }
  } catch {
    say('Cannot reach Cash Memer. Is it still running in the terminal window?');
  }
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  say('');

  const passcode = els.passcode.value;
  if (!passcode) return;

  if (firstRun && passcode !== els.confirm.value) {
    say('Those two do not match. Try again.');
    els.confirm.value = '';
    els.confirm.focus();
    return;
  }

  els.submit.disabled = true;
  els.submit.textContent = 'Checking…';

  try {
    const response = await fetch(firstRun ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode, label: navigator.userAgent.slice(0, 100) }),
    });
    const result = await response.json().catch(() => ({}));

    if (response.ok && result.ok) {
      location.replace(nextUrl());
      return;
    }

    say(result.error ?? 'That did not work.');
    els.passcode.value = '';
    els.passcode.focus();
  } catch {
    say('Cannot reach Cash Memer. Is it still running in the terminal window?');
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = firstRun ? 'Set passcode and open' : 'Unlock';
  }
});

loadState();
