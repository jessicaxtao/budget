/** Compare components: URL.origin is "null" for custom schemes in Node. */
function sameOrigin(value, expected) {
  try {
    const url = new URL(value);
    const allowed = new URL(expected);
    return !url.username && !url.password &&
      url.protocol === allowed.protocol && url.host === allowed.host;
  } catch {
    return false;
  }
}

function trustedSender(event, trustedContents, expected) {
  try {
    const sender = event.sender;
    const frame = event.senderFrame;
    return Boolean(sender && trustedContents.has(sender) && !sender.isDestroyed() &&
      frame && frame === sender.mainFrame && sameOrigin(frame.url, expected));
  } catch {
    // A frame can detach between receiving the message and inspecting it.
    return false;
  }
}

module.exports = { sameOrigin, trustedSender };
