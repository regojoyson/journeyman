/**
 * @file format-ticket-md.ts
 * Renders a Ticket object as a markdown string for use in AI prompts.
 *
 * AI phases (analyze, plan, implement) receive `ticketMd` rather than the raw Ticket
 * object so the prompt is always a predictable markdown string regardless of which
 * ticket provider produced the ticket. Falls back gracefully when title or description
 * are missing.
 */

import type { Ticket } from "@journeyman/core";

/** Build a markdown string from a Ticket, defending against missing title/description. */
export function formatTicketMd(ticket: Ticket): string {
  const title = (ticket.title ?? "").trim() || `Ticket ${ticket.id}`;
  const body = (ticket.description ?? "").trim();
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}
