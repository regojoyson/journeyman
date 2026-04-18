import type {
  IProviderMeta, ICodingCLI, IGitProvider, ITicketProvider, INotificationProvider,
  ProductConfig, FlowDefinition,
} from "@journeyman/core";

type ProviderCtor = new (opts?: any) => unknown;
type ProviderClass = ProviderCtor & { meta: IProviderMeta };

export type ResolvedProviders = {
  coding: ICodingCLI;
  git: IGitProvider;
  ticket: ITicketProvider;
  notification: INotificationProvider;
};

export class ProviderRegistry {
  private byCategory: Record<IProviderMeta["category"], Map<string, ProviderClass>> = {
    "coding-cli": new Map(),
    git: new Map(),
    ticket: new Map(),
    notification: new Map(),
  };

  register(cls: ProviderClass): void {
    const meta = cls.meta;
    if (!meta || !meta.id || !meta.category) {
      throw new Error(`Provider class missing static meta: ${(cls as any).name ?? "(anonymous)"}`);
    }
    this.byCategory[meta.category].set(meta.id, cls);
  }

  resolveForProduct(flow: FlowDefinition, productConfig: ProductConfig): ResolvedProviders {
    const cfg = productConfig.providerConfig ?? {};
    return {
      coding: this.instantiate("coding-cli", flow.providers.coding, cfg.coding) as ICodingCLI,
      git: this.instantiate("git", flow.providers.git, cfg.git) as IGitProvider,
      ticket: this.instantiate("ticket", flow.providers.ticket, cfg.ticket) as ITicketProvider,
      notification: this.instantiate("notification", flow.providers.notification, cfg.notification) as INotificationProvider,
    };
  }

  listByCategory(category: IProviderMeta["category"]): IProviderMeta[] {
    return [...this.byCategory[category].values()].map(c => c.meta);
  }

  classOf(category: IProviderMeta["category"], id: string): ProviderClass | undefined {
    return this.byCategory[category].get(id);
  }

  private instantiate(category: IProviderMeta["category"], id: string, opts?: Record<string, unknown>): unknown {
    const cls = this.byCategory[category].get(id);
    if (!cls) throw new Error(`No ${category} provider registered with id "${id}"`);
    return opts ? new cls(opts) : new cls();
  }
}
