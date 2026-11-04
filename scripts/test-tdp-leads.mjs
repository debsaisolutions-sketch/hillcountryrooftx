/**
 * Local lead-form test. fetch is mocked; this file never calls the live intake API.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SCRIPT = readFileSync(new URL('../js/tdp-leads.js', import.meta.url), 'utf8');
const PROFILE_ID = '63e7470e-fe1e-4367-aae0-56d0d6392d78';
const PAGE = 'https://hillcountryroofing.net/?utm_source=test&utm_medium=cpc&utm_campaign=roof';

function createElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    value: '',
    name: '',
    type: '',
    style: {},
    tabIndex: 0,
    autocomplete: '',
    defer: false,
    src: '',
    disabled: false,
    attrs: {},
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null;
    },
  };
}

function createForm(fields) {
  const elements = [];
  const listeners = {};
  const form = {
    dataset: {},
    elements,
    listeners,
    resetCount: 0,
    appendChild(el) {
      elements.push(el);
    },
    querySelector(sel) {
      if (sel === '.form-status') {
        return elements.find((el) => el.className === 'form-status') || null;
      }
      const named = /^\[name="([^"]+)"\]$/.exec(sel);
      if (named) return elements.find((el) => el.name === named[1]) || null;
      if (sel.includes('button[type="submit"]')) {
        return (
          elements.find(
            (el) => el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && el.type === 'submit')
          ) || null
        );
      }
      return null;
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    removeAttribute() {},
    reset() {
      this.resetCount += 1;
      elements.forEach((el) => {
        if ('value' in el && el.tagName !== 'BUTTON') el.value = '';
      });
    },
  };

  Object.entries(fields).forEach(([name, value]) => {
    elements.push({
      tagName: 'INPUT',
      name,
      value,
      type: 'text',
      className: name === 'company_website' ? 'hp-field' : '',
      attrs: {},
      setAttribute() {},
      getAttribute() {
        return null;
      },
    });
  });
  const button = createElement('button');
  button.type = 'submit';
  button.textContent = 'Request Free Estimate';
  elements.push(button);
  form.button = button;
  return form;
}

function boot({ fields, status = 201, failNetwork = false, includeAttribution = true, clockStart = 1_700_000_000_000 }) {
  const form = createForm(fields);
  const calls = [];
  let release;
  const headNodes = [];
  let clock = clockStart;
  const document = {
    readyState: 'complete',
    head: {
      appendChild(node) {
        headNodes.push(node);
      },
    },
    documentElement: { appendChild(node) { headNodes.push(node); } },
    querySelector(sel) {
      if (String(sel).includes('tdp-lead-attribution') && includeAttribution) {
        return { src: 'https://www.tradedeskpro.com/js/tdp-lead-attribution.js' };
      }
      return null;
    },
    querySelectorAll(sel) {
      return sel === 'form' ? [form] : [];
    },
    createElement,
    addEventListener() {},
  };

  const fetchMock = (url, init) => {
    calls.push({ url, init });
    if (failNetwork) return Promise.reject(new Error('offline'));
    return new Promise((resolve) => {
      release = () =>
        resolve({
          status,
          ok: status >= 200 && status < 300,
          text: async () => '',
          json: async () => ({ ok: true }),
        });
    });
  };

  const context = {
    document,
    URLSearchParams,
    fetch: fetchMock,
    Date: { now: () => clock },
    window: {
      location: { href: PAGE, search: new URL(PAGE).search },
      tdpLeadAttribution: includeAttribution
        ? () => ({
            landing_url: PAGE,
            first_touch_url: 'https://hillcountryroofing.net/',
            utm_source: 'test',
            utm_medium: 'cpc',
            utm_campaign: 'roof',
            utm_term: '',
            utm_content: '',
          })
        : undefined,
    },
  };
  context.window.window = context.window;
  vm.runInNewContext(SCRIPT, context, { filename: 'tdp-leads.js' });

  return {
    form,
    calls,
    headNodes,
    advance(ms) {
      clock += ms;
    },
    release() {
      if (!release) throw new Error('fetch was not called');
      release();
    },
    status() {
      return form.querySelector('.form-status');
    },
    submit() {
      return form.listeners.submit({ preventDefault() {} });
    },
  };
}

const filled = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '(830) 354-5402',
  service: 'Roof repair',
  area: 'Kerrville',
  message: 'Hail dents on the south slope',
  company_website: '',
};

function payloadOf(call) {
  assert.equal(call.url, 'https://www.tradedeskpro.com/api/leads');
  assert.deepEqual(Object.keys(call.init.headers), ['Content-Type']);
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(call.init.method, 'POST');
  return JSON.parse(call.init.body);
}

test('source does not put a lead secret in the browser', () => {
  assert.equal(SCRIPT.includes('X-TDP-' + 'Lead-Secret'), false);
  assert.equal(SCRIPT.includes('63e7470e-fe1e-4367-aae0-56d0d6392d78'), true);
});

test('201 posts the lead and shows success', async () => {
  const harness = boot({ fields: { ...filled } });
  harness.advance(3000);
  const pending = harness.submit();
  assert.equal(harness.form.button.disabled, true);
  assert.equal(harness.form.button.textContent, 'Sending...');
  assert.equal(harness.calls.length, 1);
  const body = payloadOf(harness.calls[0]);
  assert.deepEqual(body, {
    name: 'Ada Lovelace',
    profile_id: PROFILE_ID,
    phone: '(830) 354-5402',
    message: 'Service: Roof repair\nArea: Kerrville\nHail dents on the south slope',
    source: 'hillcountryroofing.net',
    landing_url: PAGE,
    email: 'ada@example.com',
    first_touch_url: 'https://hillcountryroofing.net/',
    utm_source: 'test',
    utm_medium: 'cpc',
    utm_campaign: 'roof',
  });
  harness.release();
  await pending;
  assert.equal(harness.status().getAttribute('data-kind'), 'success');
  assert.match(harness.status().textContent, /Request received/);
  assert.equal(harness.form.button.disabled, true);
  assert.equal(harness.form.button.textContent, 'Sent');
  assert.equal(harness.calls.length, 1);
});

test('202 filtered is still a friendly success', async () => {
  const harness = boot({ fields: { ...filled }, status: 202 });
  harness.advance(3000);
  const pending = harness.submit();
  harness.release();
  await pending;
  assert.equal(harness.status().getAttribute('data-kind'), 'success');
  assert.doesNotMatch(harness.status().textContent, /filter/i);
});

for (const status of [403, 429, 500]) {
  test(`${status} keeps the lead off the page and offers the phone`, async () => {
    const harness = boot({ fields: { ...filled }, status });
    harness.advance(3000);
    const pending = harness.submit();
    harness.release();
    await pending;
    assert.equal(harness.status().getAttribute('data-kind'), 'error');
    assert.match(harness.status().textContent, /\(830\) 354-5402/);
    assert.equal(harness.form.button.disabled, false);
    assert.equal(harness.form.button.textContent, 'Request Free Estimate');
  });
}

test('network failure offers the phone and does not throw', async () => {
  const harness = boot({ fields: { ...filled }, failNetwork: true });
  harness.advance(3000);
  await harness.submit();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.status().getAttribute('data-kind'), 'error');
  assert.match(harness.status().textContent, /\(830\) 354-5402/);
});

test('honeypot shows success and does not post', async () => {
  const harness = boot({ fields: { ...filled, company_website: 'https://spam.example' } });
  harness.advance(5000);
  await harness.submit();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.status().getAttribute('data-kind'), 'success');
});

test('submits faster than 3 seconds are dropped', async () => {
  const harness = boot({ fields: { ...filled } });
  await harness.submit();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.status().getAttribute('data-kind'), 'success');
  harness.advance(2999);
  Object.entries(filled).forEach(([name, value]) => {
    const el = harness.form.querySelector(`[name="${name}"]`);
    if (el) el.value = value;
  });
  await harness.submit();
  assert.equal(harness.calls.length, 0);
  harness.advance(1);
  Object.entries(filled).forEach(([name, value]) => {
    const el = harness.form.querySelector(`[name="${name}"]`);
    if (el) el.value = value;
  });
  const pending = harness.submit();
  assert.equal(harness.calls.length, 1);
  harness.release();
  await pending;
});

test('missing name or phone does not post', async () => {
  const harness = boot({ fields: { ...filled, name: '   ', phone: '' } });
  harness.advance(4000);
  await harness.submit();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.status().getAttribute('data-kind'), 'error');
  assert.match(harness.status().textContent, /\(830\) 354-5402/);
});

test('reads utm fields from the page when attribution has not run', async () => {
  const direct = boot({
    fields: { name: 'Grace Hopper', phone: '8303541111', company_website: '' },
    includeAttribution: false,
  });
  direct.advance(3000);
  const pending = direct.submit();
  const body = payloadOf(direct.calls[0]);
  assert.equal(body.utm_source, 'test');
  assert.equal(body.utm_medium, 'cpc');
  assert.equal(body.utm_campaign, 'roof');
  assert.equal(body.email, undefined);
  assert.equal(body.message, '');
  assert.equal(body.first_touch_url, PAGE);
  assert.equal(direct.headNodes.length, 1);
  assert.equal(direct.headNodes[0].src, 'https://www.tradedeskpro.com/js/tdp-lead-attribution.js');
  direct.release();
  await pending;
});

test('homepage form no longer posts to a placeholder endpoint', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(/<form\b[^>]*\baction\s*=/i.test(html), false);
  assert.match(html, /name="company_website"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /autocomplete="off"/);
  assert.match(html, /src="\/js\/tdp-leads\.js"/);
  assert.match(html, /name="phone"[^>]*required/);
  assert.match(html, /name="service"/);
  assert.doesNotMatch(html, new RegExp('form' + 'spree', 'i'));
  assert.doesNotMatch(html, new RegExp('555' + '-\\d'));
});
