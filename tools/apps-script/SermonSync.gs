/**
 * Sermon sync - Biserica Harul
 * =============================
 * Runs in the church Google account (grbcsac@gmail.com) on a 15-minute timer.
 *
 * What it does, each run:
 *   1. Looks in Gmail for unprocessed Credo Translation sermon summaries.
 *   2. Turns each one into structured bilingual data - preferring the JSON
 *      attachment, falling back to parsing the plain-text template.
 *   3. Commits it to the website repo as a DRAFT (published: false).
 *   4. Labels the thread so it is never processed twice.
 *
 * It does NOT touch YouTube. Retitling a public video is a separate step,
 * added once this side has been running correctly for a few weeks.
 *
 * Nothing it writes is visible on the site until you open /admin and publish it.
 *
 * ---------------------------------------------------------------------------
 * SETUP (once)
 *   1. Script Properties (Project Settings -> Script Properties):
 *        GITHUB_TOKEN   a fine-grained PAT, Contents: Read and write,
 *                       scoped to lgrassu/harul-website ONLY
 *        GITHUB_REPO    lgrassu/harul-website
 *        NOTIFY_EMAIL   where to send "needs attention" mail
 *   2. Run setUp() once, approve the permission prompt.
 *   3. Check it worked:  runOnce()  then look at the repo.
 * ---------------------------------------------------------------------------
 */

var CFG = {
  CHURCH_ID: 'harul',           // must match church_id in Credo's JSON
  SENDER: 'admin@credotranslation.com',
  SUBJECT_HINT: 'Sermon summary',
  LABEL_DONE: 'credo/processed',
  LABEL_HELP: 'credo/needs-attention',
  REPO_DIR: 'sermons',          // where notes land in the repo
  BRANCH: 'main',
  LOOKBACK_DAYS: 30
};

// ===========================================================================
// Entry points
// ===========================================================================

/** Run once by hand to create labels and install the timer. */
function setUp() {
  [CFG.LABEL_DONE, CFG.LABEL_HELP].forEach(function (n) {
    if (!GmailApp.getUserLabelByName(n)) GmailApp.createLabel(n);
  });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runOnce') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runOnce').timeBased().everyMinutes(15).create();
  Logger.log('Labels ready, 15-minute trigger installed.');
}

/** The timer calls this. Safe to run by hand any time. */
function runOnce() {
  var done = GmailApp.getUserLabelByName(CFG.LABEL_DONE);
  var help = GmailApp.getUserLabelByName(CFG.LABEL_HELP);
  if (!done || !help) { throw new Error('Run setUp() first.'); }

  var query = 'from:' + CFG.SENDER +
              ' subject:"' + CFG.SUBJECT_HINT + '"' +
              ' -label:' + CFG.LABEL_DONE.replace('/', '-') +
              ' -label:' + CFG.LABEL_HELP.replace('/', '-') +
              ' newer_than:' + CFG.LOOKBACK_DAYS + 'd';

  var threads = GmailApp.search(query, 0, 10);
  Logger.log(threads.length + ' unprocessed thread(s)');

  threads.forEach(function (thread) {
    var msg = thread.getMessages()[thread.getMessages().length - 1];
    try {
      var data = extractSermon_(msg);
      if (!data) throw new Error('Could not read this email - the format may have changed.');
      commitToGitHub_(data);
      thread.addLabel(done);
      Logger.log('Committed ' + data.service_date);
    } catch (err) {
      thread.addLabel(help);
      notifyFailure_(msg, err);
      Logger.log('FAILED ' + msg.getSubject() + ' :: ' + err.message);
    }
  });
}

// ===========================================================================
// Reading the email
// ===========================================================================

/** JSON attachment if present, otherwise the prose template. */
function extractSermon_(msg) {
  var fromJson = readJsonAttachment_(msg);
  if (fromJson) return fromJson;

  var parsed = parseProse_(msg.getPlainBody());
  if (!parsed) return null;

  return {
    schema: 'credo.sermon.v1',
    source_format: 'prose',
    service_date: dateFromSubject_(msg.getSubject()) ||
                  Utilities.formatDate(msg.getDate(), 'America/Los_Angeles', 'yyyy-MM-dd'),
    email_received: msg.getDate().toISOString(),
    published: false,
    en: parsed.en,
    ro: parsed.ro
  };
}

function readJsonAttachment_(msg) {
  var atts = msg.getAttachments();
  for (var i = 0; i < atts.length; i++) {
    var a = atts[i];
    if (!/\.json$/i.test(a.getName())) continue;
    try {
      var d = JSON.parse(a.getDataAsString('UTF-8'));
      if (!d.en || !d.ro) continue;             // not the shape we expect

      // Credo sends church_id; refuse anything not addressed to this church.
      if (d.church_id && d.church_id !== CFG.CHURCH_ID) {
        throw new Error('Email is for church_id "' + d.church_id +
                        '", expected "' + CFG.CHURCH_ID + '".');
      }

      // "passage" may arrive per-language (book names differ: Galatians /
      // Galateni) or once at the top level. Normalise onto both blocks.
      ['en', 'ro'].forEach(function (L) {
        if (!d[L].passage && d.passage) d[L].passage = d.passage;
      });

      d.source_format = 'json';
      d.email_received = msg.getDate().toISOString();
      if (d.published === undefined) d.published = false;
      if (!d.service_date) d.service_date = dateFromSubject_(msg.getSubject());
      return d;
    } catch (e) {
      // A church_id mismatch is a real problem worth surfacing, not something
      // to paper over by falling back to the prose parser.
      if (e.message && e.message.indexOf('church_id') !== -1) throw e;
    }
  }
  return null;
}

var LANG_ = {
  en: { header: 'SERMON SUMMARY',     theme: 'Theme:', summary: 'In short:',
        points: 'Main points:',       verses: 'Key verses:',
        application: 'For this week:' },
  ro: { header: 'REZUMATUL PREDICII', theme: 'Tema:',  summary: 'Pe scurt:',
        points: 'Ideile principale:', verses: 'Versete-cheie:',
        application: 'Pentru săptămâna aceasta:' }
};

/** Returns {en, ro} or null. Never returns a partial result. */
function parseProse_(body) {
  var parts = body.split(/—{6,}/).map(function (s) { return s.trim(); })
                  .filter(Boolean);
  var enPart = parts.filter(function (p) { return p.indexOf(LANG_.en.header) !== -1; })[0];
  var roPart = parts.filter(function (p) { return p.indexOf(LANG_.ro.header) !== -1; })[0];
  if (!enPart || !roPart) return null;

  var en = parseBlock_(enPart, LANG_.en);
  var ro = parseBlock_(roPart, LANG_.ro);
  return (en && ro) ? { en: en, ro: ro } : null;
}

function parseBlock_(block, L) {
  var lines = block.split('\n').map(function (s) { return s.trim(); });
  var h = lines.indexOf(L.header);
  if (h === -1) return null;
  var title = lines[h + 2];                     // header, date line, then title
  if (!title) return null;

  var theme   = between_(block, L.theme,   [L.summary]);
  var summary = between_(block, L.summary, [L.points]);
  var ptsRaw  = between_(block, L.points,  [L.verses]);
  var versRaw = between_(block, L.verses,  [L.application]);
  var apply   = between_(block, L.application, ['——']);
  if (!theme || !summary || !ptsRaw) return null;

  var points = ptsRaw.split(/\n(?=\s*\d+\.\s)/).map(function (p) {
    return p.replace(/^\s*\d+\.\s*/, '').replace(/\s*\n\s*/g, ' ').trim();
  }).filter(Boolean).map(function (p) {
    var c = p.indexOf(':');
    return c === -1 ? { heading: '', body: p }
                    : { heading: p.slice(0, c).trim(), body: p.slice(c + 1).trim() };
  });

  var verses = (versRaw || '').replace(/\s*\n\s*/g, ' ').split('·')
                 .map(function (v) { return v.trim(); }).filter(Boolean);

  return {
    title: tidy_(title), theme: tidy_(theme), summary: tidy_(summary),
    points: points, key_verses: verses, application: tidy_(apply)
  };
}

function between_(text, startLabel, endLabels) {
  var i = text.indexOf(startLabel);
  if (i === -1) return '';
  var from = i + startLabel.length, to = text.length;
  endLabels.forEach(function (e) {
    var j = text.indexOf(e, from);
    if (j !== -1 && j < to) to = j;
  });
  return text.slice(from, to).trim();
}

function tidy_(s) { return (s || '').replace(/\s*\n\s*/g, ' ').trim(); }

function dateFromSubject_(subject) {
  var m = subject.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  var months = { January:1, February:2, March:3, April:4, May:5, June:6, July:7,
                 August:8, September:9, October:10, November:11, December:12 };
  var mo = months[m[1]];
  if (!mo) return null;
  return m[3] + '-' + pad_(mo) + '-' + pad_(+m[2]);
}
function pad_(n) { return (n < 10 ? '0' : '') + n; }

// ===========================================================================
// Writing to the repo
// ===========================================================================

function commitToGitHub_(data) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN');
  var repo  = props.getProperty('GITHUB_REPO');
  if (!token || !repo) throw new Error('GITHUB_TOKEN / GITHUB_REPO not set in Script Properties.');

  var path = CFG.REPO_DIR + '/' + data.service_date + '.json';
  var url  = 'https://api.github.com/repos/' + repo + '/contents/' + path;
  var body = Utilities.base64Encode(
    Utilities.newBlob(JSON.stringify(data, null, 2)).getBytes(), Utilities.Charset.UTF_8);

  // If the file is already there, we need its sha to update it.
  var sha = null;
  var probe = UrlFetchApp.fetch(url + '?ref=' + CFG.BRANCH, {
    method: 'get', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }
  });
  if (probe.getResponseCode() === 200) sha = JSON.parse(probe.getContentText()).sha;

  var payload = {
    message: 'Sermon notes for ' + data.service_date + ' (draft, via Credo email)',
    content: body,
    branch: CFG.BRANCH
  };
  if (sha) payload.sha = sha;

  var res = UrlFetchApp.fetch(url, {
    method: 'put', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' }
  });
  var code = res.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub returned ' + code + ': ' + res.getContentText().slice(0, 300));
  }
}

// ===========================================================================
// When something goes wrong
// ===========================================================================

function notifyFailure_(msg, err) {
  var to = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (!to) return;
  MailApp.sendEmail({
    to: to,
    subject: 'Sermon sync needs attention: ' + msg.getSubject(),
    body: [
      'The sermon summary below could not be turned into notes, so nothing was',
      'published. The email is labelled "' + CFG.LABEL_HELP + '" in Gmail.',
      '',
      'Reason: ' + err.message,
      '',
      'Received: ' + msg.getDate(),
      'Subject:  ' + msg.getSubject(),
      '',
      'Most likely the email template changed. Once it is sorted, remove the',
      'label and the next run will pick it up again.'
    ].join('\n')
  });
}
