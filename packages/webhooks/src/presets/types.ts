import type {
  PresetId,
  WebhookAuthConfig,
  WebhookKind,
} from "@journeyman/core";

export type PresetManifest = {
  id: PresetId;
  name: string;
  kind: WebhookKind;
  icon?: string;
  docsUrl?: string;

  auth: WebhookAuthConfig;

  eventTypePath?: string;
  deliveryIdHeader?: string;

  knownEventTypes?: string[];

  /** Schema relative to the preset directory; loader replaces with the parsed object. */
  payloadSchemaRef?: string;

  /** Sample events relative to preset dir; loader leaves these as strings. */
  sampleEvents?: Record<string, string>;
};

export type LoadedPreset = Omit<PresetManifest, "payloadSchemaRef"> & {
  payloadSchema?: unknown;
  samples?: Record<string, unknown>;
};
