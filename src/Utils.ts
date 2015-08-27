var http = require("http");
var url = require("url");

module Manifesto {
    export class Utils {

        static getLocalisedValue(resource: any): string {

            // if the resource is not an array of translations, return the string.
            if (!_isArray(resource)){
                return resource;
            }

            var locale = (<IIIIFResource>resource).options.locale;

            // test for exact match
            for (var i = 0; i < resource.length; i++){
                var value = resource[i];
                var language = value['@language'];

                if (locale === language){
                    return <string>value['@value'];
                }
            }

            // test for inexact match
            var match = locale.substr(0, locale.indexOf('-'));

            for (var i = 0; i < resource.length; i++){
                var value = resource[i];
                var language = value['@language'];

                if (language === match){
                    return <string>value['@value'];
                }
            }

            return null;
        }

        static getMetadata(resource: IJSONLDResource): any{
            var metadata: Object[] = resource.getProperty('metadata');

            // get localised value for each metadata item.
            for (var i = 0; i < metadata.length; i++) {
                var item: any = metadata[i];

                item.label = this.getLocalisedValue(item.label);
                item.value  = this.getLocalisedValue(item.value);
            }

            return metadata;
        }

        static getRendering(resource: IJSONLDResource, format: RenderingFormat | string): IRendering {
            var renderings: IRendering[] = this.getRenderings(resource);

            // normalise format to string
            if (typeof format !== 'string'){
                format = (<RenderingFormat>format).toString();
            }

            for (var i = 0; i < renderings.length; i++){
                var rendering: IRendering = renderings[i];

                if (rendering.getFormat().toString() === format) {
                    return rendering;
                }
            }

            return null;
        }

        static getRenderings(resource: any): IRendering[] {
            var rendering;

            // if passing a parsed object, use the __jsonld.rendering property,
            // otherwise look for a rendering property
            if (resource.__jsonld){
                rendering = resource.__jsonld.rendering;
            } else {
                rendering = resource.rendering;
            }

            var parsed: IRendering[] = [];

            if (!rendering){
                return parsed;
            }

            // normalise to array
            if (!_isArray(rendering)){
                rendering = [rendering];
            }

            for (var i = 0; i < rendering.length; i++){
                var r: any = rendering[i];
                parsed.push(new Rendering(r));
            }

            return parsed;
        }

        static getService(resource: IJSONLDResource, profile: ServiceProfile | string): IService {

            var services: IService[] = this.getServices(resource);

            // normalise profile to string
            if (typeof profile !== 'string'){
                profile = (<ServiceProfile>profile).toString();
            }

            for (var i = 0; i < services.length; i++){
                var service: IService = services[i];

                if (service.getProfile().toString() === profile) {
                    return service;
                }
            }

            return null;
        }

        static getServices(resource: any): IService[] {
            var service;

            // if passing a parsed object, use the __jsonld.service property,
            // otherwise look for a service property
            if (resource.__jsonld){
                service = resource.__jsonld.service;
            } else {
                service = (<any>resource).service;
            }

            var parsed: IService[] = [];

            if (!service) return parsed;

            // normalise to array
            if (!_isArray(service)){
                service = [service];
            }

            for (var i = 0; i < service.length; i++){
                var s: any = service[i];
                s.__manifest = this;
                parsed.push(new Service(s));
            }

            return parsed;
        }

        static loadResource (uri: string): Promise<any> {

            return new Promise<any>((resolve, reject) => {
                var u = url.parse(uri);

                var fetch = http.request({
                    host: u.hostname,
                    port: u.port || 80,
                    path: u.pathname,
                    method: "GET",
                    withCredentials: false
                }, (res) => {
                    var result = "";
                    res.on('data', (chunk) => {
                        result += chunk;
                    });
                    res.on('end', () => {
                        resolve(result);
                    });
                });

                fetch.end();
            });
        }

        static loadExternalResource(resource: IExternalResource,
                     clickThrough: (resource: IExternalResource) => Promise<void>,
                     login: (resource: IExternalResource) => Promise<void>,
                     getAccessToken: (resource: IExternalResource) => Promise<IAccessToken>,
                     storeAccessToken: (resource: IExternalResource, token: IAccessToken) => Promise<void>,
                     getStoredAccessToken: (resource: IExternalResource) => Promise<IAccessToken>,
                     handleResourceResponse: (resource: IExternalResource) => Promise<any>,
                     options?: IManifestoOptions): Promise<IExternalResource> {

            return new Promise<any>((resolve, reject) => {

                if (options && options.pessimisticAccessControl){

                    // pessimistic: access control cookies may have been deleted.
                    // always request the access token for every access controlled info.json request
                    // returned access tokens are not stored, therefore the login window flashes for every request.

                    resource.getData().then(() => {
                        if (resource.isAccessControlled()){
                            // if the resource has a click through service, use that.
                            if (resource.clickThroughService){
                                resolve(clickThrough(resource));
                            } else {
                                login(resource).then(() => {
                                    getAccessToken(resource).then((token: IAccessToken) => {
                                        resource.getData(token).then(() => {
                                            resolve(handleResourceResponse(resource));
                                        });
                                    });
                                });
                            }
                        } else {
                            // this info.json isn't access controlled, therefore no need to request an access token.
                            resolve(resource);
                        }
                    });
                } else {

                    // optimistic: access control cookies may not have been deleted.
                    // store access tokens to avoid login window flashes.
                    // if cookies are deleted a page refresh is required.

                    // try loading the resource using an access token that matches the info.json domain.
                    // if an access token is found, request the resource using it regardless of whether it is access controlled.
                    getStoredAccessToken(resource).then((storedAccessToken: IAccessToken) => {
                        if (storedAccessToken) {
                            // try using the stored access token
                            resource.getData(storedAccessToken).then(() => {
                                // if the info.json loaded using the stored access token
                                if (resource.status === HTTPStatusCode.OK) {
                                    resolve(handleResourceResponse(resource));
                                } else {
                                    // otherwise, load the resource data to determine the correct access control services.
                                    // if access controlled, do login.
                                    Utils.authorize(
                                        resource,
                                        clickThrough,
                                        login,
                                        getAccessToken,
                                        storeAccessToken,
                                        getStoredAccessToken).then(() => {
                                            resolve(handleResourceResponse(resource));
                                        });
                                }
                            });
                        } else {
                            Utils.authorize(
                                resource,
                                clickThrough,
                                login,
                                getAccessToken,
                                storeAccessToken,
                                getStoredAccessToken).then(() => {
                                    resolve(handleResourceResponse(resource));
                                });
                        }
                    });
                }
            });
        }

        static loadExternalResources(resources: IExternalResource[],
                      clickThrough: (resource: IExternalResource) => Promise<void>,
                      login: (resource: IExternalResource) => Promise<void>,
                      getAccessToken: (resource: IExternalResource) => Promise<IAccessToken>,
                      storeAccessToken: (resource: IExternalResource, token: IAccessToken) => Promise<void>,
                      getStoredAccessToken: (resource: IExternalResource) => Promise<IAccessToken>,
                      handleResourceResponse: (resource: IExternalResource) => Promise<any>,
                      options?: IManifestoOptions): Promise<IExternalResource[]> {

            return new Promise<IExternalResource[]>((resolve) => {

                var promises = _map(resources, (resource: IExternalResource) => {
                    return Utils.loadExternalResource(
                        resource,
                        clickThrough,
                        login,
                        getAccessToken,
                        storeAccessToken,
                        getStoredAccessToken,
                        handleResourceResponse,
                        options);
                });

                Promise.all(promises)
                    .then(() => {
                        resolve(resources)
                    });
            });
        }

        static authorize(resource: IExternalResource,
                  clickThrough: (resource: IExternalResource) => Promise<void>,
                  login: (resource: IExternalResource) => Promise<void>,
                  getAccessToken: (resource: IExternalResource) => Promise<IAccessToken>,
                  storeAccessToken: (resource: IExternalResource, token: IAccessToken) => Promise<void>,
                  getStoredAccessToken: (resource: IExternalResource) => Promise<IAccessToken>): Promise<IExternalResource> {

            return new Promise<IExternalResource>((resolve, reject) => {

                resource.getData().then(() => {
                    if (resource.isAccessControlled()) {
                        getStoredAccessToken(resource).then((storedAccessToken: IAccessToken) => {
                            if (storedAccessToken) {
                                // try using the stored access token
                                resource.getData(storedAccessToken).then(() => {
                                    resolve(resource);
                                });
                            } else {
                                if (resource.status === HTTPStatusCode.MOVED_TEMPORARILY && !resource.isResponseHandled) {
                                    // if the resource was redirected to a degraded version
                                    // and the response hasn't been handled yet.
                                    // if the client wishes to trigger a login, set resource.isResponseHandled to true
                                    // and call loadExternalResources() again.
                                    resolve(resource);
                                } else if (resource.clickThroughService && !resource.isResponseHandled){
                                    // if the resource has a click through service, use that.
                                    clickThrough(resource).then(() => {
                                        getAccessToken(resource).then((accessToken) => {
                                            storeAccessToken(resource, accessToken).then(() => {
                                                resource.getData(accessToken).then(() => {
                                                    resolve(resource);
                                                });
                                            });
                                        });
                                    });
                                } else {
                                    // get an access token
                                    login(resource).then(() => {
                                        getAccessToken(resource).then((accessToken) => {
                                            storeAccessToken(resource, accessToken).then(() => {
                                                resource.getData(accessToken).then(() => {
                                                    resolve(resource);
                                                });
                                            });
                                        });
                                    });
                                }
                            }
                        });
                    } else {
                        // this info.json isn't access controlled, therefore there's no need to request an access token
                        resolve(resource);
                    }
                });
            });
        }
    }
};