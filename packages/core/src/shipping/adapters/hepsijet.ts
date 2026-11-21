import type { ShippingProvider } from "../../enums";
import { BaseIntegratedCargoAdapter } from "./base";

export class HepsijetAdapter extends BaseIntegratedCargoAdapter {
  readonly provider: ShippingProvider = "HEPSIJET";
  protected readonly codePrefix = "HJ";
}

