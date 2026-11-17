import type { ShippingProvider } from "../../enums";
import { BaseIntegratedCargoAdapter } from "./base";

export class UpsAdapter extends BaseIntegratedCargoAdapter {
  readonly provider: ShippingProvider = "UPS";
  protected readonly codePrefix = "1Z";
}

