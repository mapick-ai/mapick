// security / security:report handlers.

const { apiCall, missingArg } = require("./http");

async function handleSecurity(args) {
  if (args.length < 1) return missingArg("Usage: security <skillId>");
  return apiCall("GET", `/skill/${args[0]}/security`, null, "security");
}

async function handleReport(args) {
  if (args.length < 3) {
    return missingArg("Usage: security:report <skillId> <reason> <evidence>");
  }
  return apiCall(
    "POST",
    `/skill/${args[0]}/report`,
    { reason: args[1], evidenceEn: args[2] },
    "security:report",
  );
}

module.exports = { handleSecurity, handleReport };
