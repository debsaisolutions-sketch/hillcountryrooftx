/**
 * Hill Country Roofing lead form → TradeDeskPro /api/leads.
 * Browser intake uses the public profile id only. No lead secret header.
 * Loads first-touch / UTM capture when the page did not include it.
 */
(function () {
  var API_URL = 'https://www.tradedeskpro.com/api/leads';
  var PROFILE_ID = '63e7470e-fe1e-4367-aae0-56d0d6392d78';
  var SOURCE = 'hillcountryroofing.net';
  var PHONE_FALLBACK = '(830) 354-5402';
  var MIN_FILL_MS = 3000;
  var loadedAt = Date.now();

  function loadAttribution() {
    if (typeof document === 'undefined') return;
    if (document.querySelector('script[src*="tdp-lead-attribution.js"]')) return;
    var s = document.createElement('script');
    s.src = 'https://www.tradedeskpro.com/js/tdp-lead-attribution.js';
    s.defer = true;
    (document.head || document.documentElement).appendChild(s);
  }

  function field(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    if (!el || el.value == null) return '';
    return String(el.value).trim();
  }

  function pageUrl() {
    try {
      return window.location.href || '';
    } catch (e) {
      return '';
    }
  }

  function provenance() {
    var extra = {};
    try {
      if (typeof window.tdpLeadAttribution === 'function') {
        extra = window.tdpLeadAttribution() || {};
      }
    } catch (e) {}

    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    var utm = {};
    var i;
    for (i = 0; i < keys.length; i++) {
      if (extra[keys[i]]) utm[keys[i]] = String(extra[keys[i]]);
    }
    try {
      var params = new URLSearchParams(window.location.search || '');
      for (i = 0; i < keys.length; i++) {
        if (!utm[keys[i]] && params.get(keys[i])) utm[keys[i]] = params.get(keys[i]);
      }
    } catch (e2) {}

    return {
      landing_url: pageUrl(),
      first_touch_url: extra.first_touch_url ? String(extra.first_touch_url) : pageUrl(),
      utm: utm,
    };
  }

  function buildMessage(form) {
    var service = field(form, 'service');
    var area = field(form, 'area') || field(form, 'county') || field(form, 'city');
    var details = field(form, 'message') || field(form, 'details');
    var lines = [];
    if (service) lines.push('Service: ' + service);
    if (area) lines.push('Area: ' + area);
    if (details) lines.push(details);
    return lines.join('\n');
  }

  function showStatus(form, kind, text) {
    var el = form.querySelector('.form-status');
    if (!el) {
      el = document.createElement('p');
      el.className = 'form-status';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      form.appendChild(el);
    }
    el.setAttribute('data-kind', kind);
    el.textContent = text;
  }

  function submitButton(form) {
    return form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
  }

  function buttonLabel(btn) {
    if (!btn) return '';
    return btn.tagName === 'INPUT' ? btn.value : btn.textContent;
  }

  function setButtonLabel(btn, label) {
    if (!btn) return;
    if (btn.tagName === 'INPUT') btn.value = label;
    else btn.textContent = label;
  }

  function ensureHoneypot(form) {
    if (form.querySelector('[name="company_website"]')) return;
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.name = 'company_website';
    hp.className = 'hp-field';
    hp.tabIndex = -1;
    hp.autocomplete = 'off';
    hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;opacity:0;';
    form.appendChild(hp);
  }

  function quietSuccess(form, btn, original) {
    showStatus(form, 'success', 'Thanks — we received your request and will be in touch shortly.');
    if (typeof form.reset === 'function') form.reset();
    if (btn) {
      btn.disabled = false;
      setButtonLabel(btn, original);
    }
  }

  function wireForm(form) {
    if (!form || form.dataset.tdpWired === '1') return;
    form.dataset.tdpWired = '1';
    form.removeAttribute('action');
    ensureHoneypot(form);

    form.addEventListener('submit', function (e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();

      var btn = submitButton(form);
      var original = buttonLabel(btn);
      if (btn && btn.disabled) return;

      if (field(form, 'company_website')) {
        quietSuccess(form, btn, original);
        return;
      }
      if (Date.now() - loadedAt < MIN_FILL_MS) {
        quietSuccess(form, btn, original);
        return;
      }

      var name = field(form, 'name');
      var phone = field(form, 'phone');
      var email = field(form, 'email');
      if (!name || !phone) {
        showStatus(
          form,
          'error',
          'Please enter your name and phone, or call ' + PHONE_FALLBACK + '.'
        );
        return;
      }

      if (btn) {
        btn.disabled = true;
        setButtonLabel(btn, 'Sending...');
      }

      var meta = provenance();
      var body = {
        name: name,
        profile_id: PROFILE_ID,
        phone: phone,
        message: buildMessage(form),
        source: SOURCE,
        landing_url: meta.landing_url,
      };
      if (email) body.email = email;
      if (meta.first_touch_url) body.first_touch_url = meta.first_touch_url;
      Object.keys(meta.utm).forEach(function (key) {
        body[key] = meta.utm[key];
      });

      return fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          if (res && res.status >= 200 && res.status < 300) {
            showStatus(
              form,
              'success',
              "Request received. We'll contact you shortly during business hours."
            );
            if (typeof form.reset === 'function') form.reset();
            if (btn) setButtonLabel(btn, 'Sent');
            return;
          }
          throw new Error('Lead submit failed');
        })
        .catch(function () {
          showStatus(
            form,
            'error',
            "We couldn't send that from the form. Call " + PHONE_FALLBACK + " and we'll take it from here."
          );
          if (btn) {
            btn.disabled = false;
            setButtonLabel(btn, original);
          }
        });
    });
  }

  function init() {
    loadAttribution();
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) wireForm(forms[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
