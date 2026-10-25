// CSV cell escaping for the admin exports.
//
// A cell starting with = + - @ (or a tab / CR) is read as a formula by Excel
// and LibreOffice: a free-text user name (80 chars) could exfiltrate data or
// run commands. Prefixing an apostrophe makes the spreadsheet treat it as
// text (OWASP "CSV injection").
export function csvCell(v: any): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
