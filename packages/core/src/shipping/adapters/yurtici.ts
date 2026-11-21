import type { ShippingProvider } from "../../enums";
import { BaseIntegratedCargoAdapter } from "./base";

export class YurticiAdapter extends BaseIntegratedCargoAdapter {
  readonly provider: ShippingProvider = "YURTICI";
  protected readonly codePrefix = "YK";
}

