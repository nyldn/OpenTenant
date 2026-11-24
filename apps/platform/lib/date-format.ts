const utcDateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

const utcDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})

function isValidDate(value: Date) {
  return !Number.isNaN(value.getTime())
}

export function formatUtcDate(value: Date) {
  return isValidDate(value) ? utcDateFormatter.format(value) : "Unknown date"
}

export function formatUtcDateTime(value: Date) {
  return isValidDate(value) ? `${utcDateTimeFormatter.format(value)} UTC` : "Unknown date"
}
