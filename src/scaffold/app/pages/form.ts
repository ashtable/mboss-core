// Written by mBoss when this project was created.
// It is yours now — edit it freely.

import type { EmailFormField, WaitDescriptor } from '../contract.js';
import { escapeHtml } from '../email/html.js';

import { chipStrip, linkBanner, renderPage } from './shell.js';

/**
 * The pages a form link opens: the form itself,
 * what a submit lands on, what a link that has
 * already been answered lands on, and what a link
 * that does not verify lands on.
 *
 * Every sentence here is fixed. A workflow author
 * writes the email; the pages are mBoss's, so that
 * a person who has followed one of these links
 * before recognises the next one.
 */

const SUBMIT_LABEL = 'Submit & resume the workflow';

const NO_UPLOADS =
  'File uploads are switched off: this app has no object store configured.';

/**
 * Reveals conditional fields in the browser.
 *
 * Every field is in the markup and visible; this
 * hides the ones whose condition does not hold and
 * re-checks on every keystroke. It fails in the
 * safe direction — with scripting off, the page
 * shows every field, which is a form that asks one
 * question too many rather than a form that cannot
 * be completed.
 *
 * Hiding a field is not enough on its own. A
 * hidden control still validates, so a required
 * one nobody can see refuses the submit with no
 * bubble and nothing to click — a button that does
 * nothing at all. It is still posted, too, so an
 * answer the person withdrew still arrives. Only
 * disabling stops both, so a field that hides is
 * disabled and has its requiredness cleared, and
 * both come back when it shows again.
 */
const REVEAL_SCRIPT = `(function () {
  var form = document.querySelector('form');
  if (!form) return;

  var groups = [];
  document.querySelectorAll('[data-show-if]').forEach(function (node) {
    var controls = [];
    node.querySelectorAll('input, select, textarea').forEach(function (el) {
      controls.push({ el: el, required: el.required, disabled: el.disabled });
    });
    groups.push({ node: node, controls: controls });
  });

  function answer(id) {
    var field = form.elements[id];
    return field ? String(field.value || '') : '';
  }

  function holds(rule) {
    var got = answer(rule.fieldId);
    var want = rule.value;
    if (typeof want === 'boolean') want = want ? 'yes' : 'no';
    switch (rule.op) {
      case 'exists':
      case 'nonempty':
        return got !== '';
      case 'eq':
        return got === String(want);
      case 'neq':
        return got !== String(want);
      case 'gt':
        return Number(got) > Number(want);
      case 'gte':
        return Number(got) >= Number(want);
      case 'lt':
        return Number(got) < Number(want);
      case 'lte':
        return Number(got) <= Number(want);
      default:
        return true;
    }
  }

  function apply() {
    groups.forEach(function (group) {
      var show = holds(JSON.parse(group.node.dataset.showIf));
      group.node.hidden = !show;
      group.controls.forEach(function (each) {
        each.el.required = show && each.required;
        each.el.disabled = !show || each.disabled;
      });
    });
  }

  form.addEventListener('input', apply);
  form.addEventListener('change', apply);
  apply();
})();`;

export type FormPageInput = {
  /** The name people see. */
  appTitle: string;
  runId: string;
  /** Who the link was minted for. It is in the
   *  banner so a forwarded link is visibly not
   *  the reader's own. */
  recipient: string;
  /** Where the form posts, which is the link that
   *  opened it. */
  action: string;
  wait: WaitDescriptor;
  /** False when no object store is configured. */
  uploadsEnabled: boolean;
};

export function renderFormPage(input: FormPageInput): string {
  const { appTitle, runId, recipient, action, wait, uploadsEnabled } = input;
  const takesFiles =
    uploadsEnabled && wait.fields.some((f) => f.type === 'fileUpload');
  const conditional = wait.fields.some((f) => f.showIf !== undefined);

  const form = [
    `<form method="post" action="${escapeHtml(action)}"` +
      (takesFiles ? ` enctype="multipart/form-data"` : '') +
      `>`,
    ...wait.fields.map((field) => renderField(field, uploadsEnabled)),
    `<button type="submit">${escapeHtml(SUBMIT_LABEL)}</button>`,
    `</form>`,
  ].join('\n');

  return renderPage({
    title: `${appTitle} needs your input`,
    banner: linkBanner(recipient, runId),
    body: [
      `<h1>${escapeHtml(appTitle)} needs your input</h1>`,
      `<p class="lede">${escapeHtml(wait.title)}</p>`,
      form,
    ].join('\n'),
    ...(conditional ? { script: REVEAL_SCRIPT } : {}),
  });
}

function renderField(field: EmailFormField, uploadsEnabled: boolean): string {
  const id = escapeHtml(field.id);
  const attributes = [`class="field"`, `data-field="${id}"`];

  if (field.showIf !== undefined) {
    const rule = escapeHtml(JSON.stringify(field.showIf));
    attributes.push(`data-show-if="${rule}"`);
  }

  return [
    `<div ${attributes.join(' ')}>`,
    `<label class="label" for="f-${id}">${escapeHtml(field.label)}</label>`,
    control(field, uploadsEnabled),
    `</div>`,
  ].join('\n');
}

function control(field: EmailFormField, uploadsEnabled: boolean): string {
  const id = escapeHtml(field.id);
  const required = field.required ? ' required' : '';

  switch (field.type) {
    case 'fileUpload':
      return uploadsEnabled
        ? `<div class="drop">` +
            `<input type="file" id="f-${id}" name="${id}"` +
            `${field.multiple ? ' multiple' : ''}${required}>` +
            `</div>`
        : // No `required` on a control nobody can
          // fill in. A disabled control is barred
          // from constraint validation and is not
          // posted at all, so the attribute would
          // be inert — markup that reads as a
          // demand this page never makes. Hiding
          // the field would be the opposite
          // mistake: a hidden control still
          // validates, which is why the conditional
          // ones are disabled and not merely
          // hidden.
          `<div class="drop off">` +
            `<input type="file" id="f-${id}" name="${id}" disabled>` +
            `<p class="note">${escapeHtml(NO_UPLOADS)}</p>` +
            `</div>`;
    case 'textarea':
      return `<textarea id="f-${id}" name="${id}"${required}></textarea>`;
    case 'yesNo':
      return (
        `<div class="choice">` +
        `<label><input type="radio" id="f-${id}" name="${id}" ` +
        `value="yes"${required}> Yes</label>` +
        `<label><input type="radio" name="${id}" value="no"> No</label>` +
        `</div>`
      );
    case 'text':
      return `<input type="text" id="f-${id}" name="${id}"${required}>`;
  }
}

export type SubmittedPageInput = {
  appTitle: string;
  runId: string;
  /** The blocks that run next, in order. */
  downstream: readonly string[];
};

/**
 * What a submit lands on.
 *
 * It closes on what is true of every run rather
 * than on a promise. Telling somebody the draft is
 * on its way assumes a downstream that ends in an
 * email, and an arbitrary workflow has none — so
 * the page says what it does know: the run woke up,
 * and here is what it woke up into.
 */
export function renderSubmittedPage(input: SubmittedPageInput): string {
  return renderPage({
    title: 'Got it — back to work.',
    banner: null,
    body: [
      `<div class="centred">`,
      `<span class="badge">✓</span>`,
      `<h1>Got it — back to work.</h1>`,
      `<p class="lede">Run ${escapeHtml(input.runId)} woke up the moment ` +
        `you submitted. You can close this tab.</p>`,
      chipStrip(input.downstream),
      `</div>`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  });
}

/**
 * What a link whose run has already answered lands
 * on.
 *
 * The token is still perfectly valid — it has to
 * be, because nothing revokes one — so this is the
 * app's own answer rather than the link's.
 */
export function renderResolvedPage(input: {
  appTitle: string;
  runId: string;
}): string {
  return renderPage({
    title: "That one's already answered.",
    banner: null,
    body: [
      `<div class="centred">`,
      `<h1>That one's already answered.</h1>`,
      `<p class="lede">Run ${escapeHtml(input.runId)} has already had an ` +
        `answer for this step, so there is nothing left to fill in. You ` +
        `can close this tab.</p>`,
      `</div>`,
    ].join('\n'),
  });
}

/**
 * What a link that does not verify lands on.
 *
 * One word for what was wrong. Anything more
 * detailed would be telling whoever is holding the
 * link how to make a better one.
 */
export function renderInvalidPage(reason: string): string {
  return renderPage({
    title: 'This link does not work',
    banner: null,
    body: [
      `<div class="centred">`,
      `<h1>This link does not work.</h1>`,
      `<p class="lede">The link was rejected: ` +
        `${escapeHtml(reason)}. Ask whoever sent it for a fresh one.</p>`,
      `</div>`,
    ].join('\n'),
  });
}
