import type { Ticket } from "@journeyman/core";

/** Build a markdown string from a Ticket, defending against missing title/description. */
export function formatTicketMd(ticket: Ticket): string {
  const title = (ticket.title ?? "").trim() || `Ticket ${ticket.id}`;
  const body = (ticket.description ?? "").trim();
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}
