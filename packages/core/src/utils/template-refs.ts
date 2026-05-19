const TEMPLATE_REF_RE = /\{\{(.+?)\}\}/g;

export interface TemplateSegment {
  raw: string;
  ref: string;
}

export function extractTemplateRefs(template: string): TemplateSegment[] {
  const out: TemplateSegment[] = [];
  for (const m of template.matchAll(TEMPLATE_REF_RE)) {
    out.push({ raw: m[0], ref: m[1].trim() });
  }
  return out;
}

export function replaceTemplateRefs(
  template: string,
  replacer: (ref: string) => string,
): string {
  return template.replace(TEMPLATE_REF_RE, (_, inner: string) => replacer(inner.trim()));
}
