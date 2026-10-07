/**
 * Forwards PDF attachments from this mailbox into the RVR Management app.
 *
 * Paste into script.google.com under the documents Gmail account, set SECRET to
 * match INBOUND_EMAIL_SECRET on Netlify, and add a time-driven trigger on
 * forwardDocuments every 15 minutes. See docs/RUNNING-COSTS.md.
 */

var ENDPOINT = 'https://YOUR-SITE.netlify.app/api/inbound-email'
var SECRET = 'PASTE_THE_SAME_SECRET_AS_NETLIFY'

/** Dealt with. Never read again. */
var LABEL = 'RVR/processed'
/** Tried and kept failing. Somebody needs to look. */
var FAILED_LABEL = 'RVR/failed'

/**
 * How many times a message is retried before it is parked.
 *
 * The first report to arrive came back "could not read the PDF" because of a
 * bug in the app, and the old script labelled it processed and never looked at
 * it again — the mail was in the mailbox, the app said nothing was wrong, and
 * the report simply did not exist. Retrying covers the case where the fix lands
 * an hour later.
 *
 * Bounded, because a genuinely corrupt PDF would otherwise be re-posted every
 * fifteen minutes for ever. Five attempts at fifteen minutes is about an hour,
 * then it goes to RVR/failed where it can be seen.
 */
var MAX_ATTEMPTS = 5

/**
 * Only recent unprocessed mail.
 *
 * Without the date bound, the first run after the mailbox has been in use for a
 * year would try to forward a year of attachments in one execution and hit the
 * six-minute limit part way through — leaving some threads labelled and some
 * not, with no way to tell which.
 */
function searchQuery() {
  return (
    'has:attachment filename:pdf newer_than:7d -label:' + LABEL + ' -label:' + FAILED_LABEL
  )
}

function forwardDocuments() {
  var label = getOrCreate(LABEL)
  var failedLabel = getOrCreate(FAILED_LABEL)
  var props = PropertiesService.getScriptProperties()
  var threads = GmailApp.search(searchQuery(), 0, 20)

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t]
    var messages = thread.getMessages()
    var anyRetry = false
    var anyDone = false
    var exhausted = false
    var anySent = false

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m]
      var payload = pdfAttachments(msg)
      if (!payload.length) continue
      anySent = true

      var outcome = post(msg, payload)
      Logger.log(msg.getFrom() + ' -> ' + outcome.code + ' ' + outcome.reason)

      if (outcome.retry) {
        // Counted per message, not per thread: a thread can carry one report
        // that landed and another that did not.
        var key = 'attempts:' + msg.getId()
        var attempts = Number(props.getProperty(key) || 0) + 1
        props.setProperty(key, String(attempts))
        if (attempts >= MAX_ATTEMPTS) {
          exhausted = true
          Logger.log('giving up on ' + msg.getSubject() + ' after ' + attempts + ' attempts')
        } else {
          anyRetry = true
        }
      } else {
        anyDone = true
        props.deleteProperty('attempts:' + msg.getId())
      }
    }

    // A thread is only finished when nothing on it still wants another go.
    if (exhausted) thread.addLabel(failedLabel)
    else if (anyDone && !anyRetry) thread.addLabel(label)
    else if (!anySent) {
      // The search found a PDF on this thread but nothing was sendable — the
      // only case being an attachment over the size limit. Left unlabelled it
      // would be picked up again every fifteen minutes for a week, so it goes
      // where somebody will see it instead.
      Logger.log('nothing sendable on "' + thread.getFirstMessageSubject() + '" — too large?')
      thread.addLabel(failedLabel)
    }
  }
}

function getOrCreate(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name)
}

/** The PDFs on a message, base64, small enough for the app to accept. */
function pdfAttachments(msg) {
  var out = []
  var atts = msg.getAttachments()
  for (var a = 0; a < atts.length; a++) {
    var att = atts[a]
    var name = att.getName() || ''
    var isPdf =
      att.getContentType() === 'application/pdf' || name.toLowerCase().slice(-4) === '.pdf'
    if (!isPdf) continue
    // 10 MB is the app's limit. Skipping here rather than posting and being
    // rejected keeps the reason readable in the Executions log.
    if (att.getSize() > 10 * 1024 * 1024) {
      Logger.log('skipping ' + name + ': ' + att.getSize() + ' bytes')
      continue
    }
    out.push({
      filename: name,
      contentType: att.getContentType(),
      content: Utilities.base64Encode(att.getBytes()),
    })
  }
  return out
}

/**
 * Send one message's attachments, and work out whether to try again.
 *
 * A 200 is not the same as a success. The app answers 200 and describes what
 * happened in the body, so a report it could not read comes back
 * {"ok":false,...} with a perfectly healthy status code — which is exactly how
 * the first real report went missing.
 *
 * Retry on: any HTTP failure, and any attachment the app reported ok:false.
 * Those are transient or a bug, and both are worth another go.
 *
 * Do NOT retry on: a refused sender, or an attachment that was read fine and
 * was a duplicate, or not an inspection summary, or matched no field. Those are
 * settled answers and asking again produces the same one for ever.
 */
function post(msg, payload) {
  var res
  try {
    res = UrlFetchApp.fetch(ENDPOINT + '?key=' + encodeURIComponent(SECRET), {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        from: msg.getFrom(),
        subject: msg.getSubject(),
        attachments: payload,
      }),
    })
  } catch (e) {
    // The app was unreachable. Always worth another go.
    return { code: 0, retry: true, reason: 'fetch failed: ' + e }
  }

  var code = res.getResponseCode()
  var text = res.getContentText()
  if (code < 200 || code >= 300) {
    return { code: code, retry: true, reason: text.slice(0, 200) }
  }

  var body
  try {
    body = JSON.parse(text)
  } catch (e) {
    return { code: code, retry: true, reason: 'unreadable answer: ' + text.slice(0, 200) }
  }

  // Refused sender. Retrying will not make it allowed.
  if (body.ignored) {
    return { code: code, retry: false, reason: 'ignored: ' + (body.reason || '') }
  }

  var results = body.results || []
  var failed = []
  for (var i = 0; i < results.length; i++) {
    if (results[i].ok === false) failed.push(results[i].detail || 'no detail')
  }
  if (failed.length) {
    return { code: code, retry: true, reason: 'app could not use it: ' + failed.join('; ') }
  }

  var summary = []
  for (var j = 0; j < results.length; j++) {
    summary.push((results[j].status || '?') + ' ' + (results[j].detail || ''))
  }
  return { code: code, retry: false, reason: summary.join(' | ') || 'nothing to do' }
}

/**
 * Put a parked thread back in the queue.
 *
 * Run by hand after fixing whatever it was failing on. Clears the attempt
 * counters and removes RVR/failed, so the next run picks the threads up again.
 */
function retryFailed() {
  var failedLabel = getOrCreate(FAILED_LABEL)
  var props = PropertiesService.getScriptProperties()
  var threads = failedLabel.getThreads()
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages()
    for (var m = 0; m < messages.length; m++) {
      props.deleteProperty('attempts:' + messages[m].getId())
    }
    threads[t].removeLabel(failedLabel)
  }
  Logger.log('requeued ' + threads.length + ' thread(s)')
}
