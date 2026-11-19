declare module "facebook-nodejs-business-sdk" {
  export class FacebookAdsApi {
    accessToken: string;
    locale: string;
    static readonly VERSION: string;
    static readonly SDK_VERSION: string;
    static readonly GRAPH: string;
    constructor(accessToken: string, locale?: string, crashLog?: boolean);
    static init(accessToken: string, locale?: string, crashLog?: boolean): FacebookAdsApi;
    static setDefaultApi(api: FacebookAdsApi): void;
    static getDefaultApi(): FacebookAdsApi;
    setDebug(flag: boolean): FacebookAdsApi;
    call<T = Record<string, unknown>>(
      method: string,
      path: string | string[],
      params?: Record<string, unknown>,
      files?: Record<string, unknown>,
      useMultipartFormData?: boolean,
      urlOverride?: string,
    ): Promise<T>;
  }

  export class AbstractCrudObject {
    id: string;
    _data: Record<string, unknown>;
    constructor(id?: number | string | null, data?: Record<string, unknown>, parentId?: string | null, api?: FacebookAdsApi | null);
    exportAllData(): Record<string, unknown>;
  }

  export class IGMedia extends AbstractCrudObject {
    static Fields: Record<string, string>;
    get(fields: string[], params?: Record<string, unknown>): Promise<IGMedia>;
    getComments(fields: string[], params?: Record<string, unknown>, fetchFirstPage?: boolean): Promise<AbstractCrudObject[]>;
    getInsights(fields: string[], params?: Record<string, unknown>, fetchFirstPage?: boolean): Promise<AbstractCrudObject[]>;
  }

  export class IGUser extends AbstractCrudObject {
    static Fields: Record<string, string>;
    get(fields: string[], params?: Record<string, unknown>): Promise<IGUser>;
    getMedia(fields: string[], params?: Record<string, unknown>, fetchFirstPage?: boolean): Promise<IGMedia[]>;
    getStories(fields: string[], params?: Record<string, unknown>, fetchFirstPage?: boolean): Promise<IGMedia[]>;
    getInsights(fields: string[], params?: Record<string, unknown>, fetchFirstPage?: boolean): Promise<AbstractCrudObject[]>;
  }

  export class Page extends AbstractCrudObject {
    static Fields: Record<string, string>;
    get(fields: string[], params?: Record<string, unknown>): Promise<Page>;
  }

  export class AdAccount extends AbstractCrudObject {
    static Fields: Record<string, string>;
  }

  const bizSdk: {
    FacebookAdsApi: typeof FacebookAdsApi;
    AbstractCrudObject: typeof AbstractCrudObject;
    IGUser: typeof IGUser;
    IGMedia: typeof IGMedia;
    Page: typeof Page;
    AdAccount: typeof AdAccount;
  };
  export default bizSdk;
}
