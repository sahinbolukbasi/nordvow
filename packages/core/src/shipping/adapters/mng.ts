import type { ShippingProvider } from "../../enums";
import { BaseIntegratedCargoAdapter } from "./base";

export class MngAdapter extends BaseIntegratedCargoAdapter {
  readonly provider: ShippingProvider = "MNG";
  protected readonly codePrefix = "MNG";
}

