import type { ShippingProvider } from "../../enums";
import { BaseIntegratedCargoAdapter } from "./base";

export class ArasAdapter extends BaseIntegratedCargoAdapter {
  readonly provider: ShippingProvider = "ARAS";
  protected readonly codePrefix = "AR";
}

