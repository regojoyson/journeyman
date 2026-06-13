export interface SseEvent { event: string; data: string; }

function parseFrame(frame: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
    // ignore "id:" and comment lines (": ...")
  }
  if (dataLines.length === 0) return null; // comment/ping frame
  return { event, data: dataLines.join("\n") };
}

/** Split an SSE byte-buffer into complete events; return the trailing partial frame as `rest`. */
export function parseSseBuffer(buf: string): { events: SseEvent[]; rest: string } {
  const parts = buf.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: SseEvent[] = [];
  for (const p of parts) {
    const ev = parseFrame(p);
    if (ev) events.push(ev);
  }
  return { events, rest };
}
