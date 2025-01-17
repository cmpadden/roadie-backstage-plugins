import { Config } from '@backstage/config';
import axios, { AxiosRequestConfig } from 'axios';

export interface ArgoServiceApi {
  getArgoToken: (token: string) => Promise<string>;
  getArgoAppData: (
    baseUrl: string,
    argoInstanceName: string,
    options: {
      name: string,
      selector: string;
    },
    argoToken: string,
  ) => Promise<object>;
}

export type findArgoAppResp = {
  name: string;
  url: string;
};

export class ArgoService implements ArgoServiceApi {
  constructor(
    private username: string,
    private password: string,
    private config: Config,
  ) { }

  async findArgoApp(options: { name?: string, selector?: string; }): Promise<findArgoAppResp[]> {
    if (!options.name && !options.selector) {
      throw new Error('Neither name nor selector provided');
    }
    const argoApps = this.config
      .getConfigArray('argocd.appLocatorMethods')
      .filter(element => element.getString('type') === 'config');
    const appArray: Config[] = argoApps.reduce(
      (acc: Config[], argoApp: Config) =>
        acc.concat(argoApp.getConfigArray('instances')),
      [],
    );
    const argoInstanceArray = appArray.map(instance => ({
      name: instance.getString('name'),
      url: instance.getString('url'),
      token: instance.getOptionalString('token'),
    }));
    const resp = await Promise.all(
      argoInstanceArray.map(async (argoInstance: any) => {
        let token: string;
        if (!argoInstance.token) {
          token = await this.getArgoToken(argoInstance.url);
        } else {
          token = argoInstance.token;
        }
        let getArgoAppDataResp: any;
        try {
          getArgoAppDataResp = await this.getArgoAppData(
            argoInstance.url,
            argoInstance.name,
            options,
            token,
          );
        } catch (error: any) {
          getArgoAppDataResp = { error: true };
        }
        if (!getArgoAppDataResp.error) {
          return {
            name: argoInstance.name as string,
            url: argoInstance.url as string,
          };
        }
        return null;
      }),
    ).catch();
    return resp.flatMap(f => (f ? [f] : []));
  }

  async getArgoToken(baseUrl: string): Promise<string> {
    const options: AxiosRequestConfig = {
      method: 'POST',
      url: `${baseUrl}/api/v1/session`,
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        username: `${this.username}`,
        password: `${this.password}`,
      },
    };

    try {
      const resp = await axios.request(options);
      return resp.data.token;
    } catch {
      throw new Error(
        `Could not retrieve ArgoCD token for instance. ${baseUrl}`,
      );
    }
  }

  async getArgoAppData(
    baseUrl: string,
    argoInstanceName: string,
    options: {
      name?: string,
      selector?: string;
    },
    argoToken: string,
  ): Promise<any> {
    const urlSuffix = options.name ? `/${options.name}` : `?selector=${options.selector}`;
    const requestOptions: AxiosRequestConfig = {
      method: 'GET',
      url: `${baseUrl}/api/v1/applications${urlSuffix}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${argoToken}`,
      },
    };
    try {
      const resp = await axios.request(requestOptions);
      if (resp.data.items) {
        (resp.data.items as any[]).forEach(item => { item.metadata.instance = { name: argoInstanceName }; });
      } else {
        resp.data.instance = argoInstanceName;
      }
      return resp.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return error.response?.data;
      }
      throw new Error('Could not retrieve ArgoCD app data.');
    }
  }
}
