import type { ShippingProvider } from "../../enums";
import type { ICargoProvider } from "../types";
import { ArasAdapter } from "./aras";
import { HepsijetAdapter } from "./hepsijet";
import { KolayGelsinAdapter } from "./kolay-gelsin";
import { ManualCargoAdapter } from "./manual";
import { MngAdapter } from "./mng";
import { NavlungoAdapter } from "./navlungo";
import { UpsAdapter } from "./ups";
import { YurticiAdapter } from "./yurtici";

const ADAPTERS: Record<ShippingProvider, ICargoProvider> = {
  NAVLUNGO: new NavlungoAdapter(),
  YURTICI: new YurticiAdapter(),
  ARAS: new ArasAdapter(),
  MNG: new MngAdapter(),
  UPS: new UpsAdapter(),
  HEPSIJET: new HepsijetAdapter(),
  KOLAY_GELSIN: new KolayGelsinAdapter(),
  CUSTOM_MANUAL: new ManualCargoAdapter(),
};

export function getCargoAdapter(provider: ShippingProvider): ICargoProvider {
  return ADAPTERS[provider];
}

