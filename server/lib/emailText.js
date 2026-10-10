"use strict";

// Strip reply chain quoted text from email body before embedding
function stripReplyChain(text) {
  if (!text) return "";
  const cutMarkers = [
    /^On .{10,200} wrote:\s*$/m,          // Gmail/Apple: "On Mon 12 May, John wrote:"
    /^-{5,}[\s\S]*?Original Message/m,    // Outlook: "-----Original Message-----"
    /^From:.+\nSent:.+\nTo:/m,            // Outlook reply header block
    /^_{10,}$/m,                           // Outlook underline separator
    /^>+ /m,                               // Quoted lines starting with ">"
  ];
  let result = text;
  for (const marker of cutMarkers) {
    const match = result.match(marker);
    // Only cut if marker isn't right at the start (avoid gutting genuine content)
    if (match && match.index > 80) {
      result = result.slice(0, match.index);
    }
  }
  return result.trim();
}

module.exports = { stripReplyChain };
