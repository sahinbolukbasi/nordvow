import type { ShippingProvider } from "../../enums";
import { BaseIntegratedCargoAdapter } from "./base";

export class KolayGelsinAdapter extends BaseIntegratedCargoAdapter {
  readonly provider: ShippingProvider = "KOLAY_GELSIN";
  protected readonly codePrefix = "KG";
}

