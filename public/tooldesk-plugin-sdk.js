(function (global) {
  'use strict';

  var SDK_VERSION = '1.0.0';
  var HOST_API_VERSION = '1.0.0';
  var DEFAULT_INVOKE_TIMEOUT_MS = 60000;
  var INVOKE_TIMEOUT_GRACE_MS = 15000;
  var MAX_CONFIGURED_INVOKE_TIMEOUT_MS = 30 * 60 * 1000;

  var ERROR_CODES = {
    PLUGIN_API_DENIED: 'PLUGIN_API_DENIED',
    PLUGIN_API_UNAVAILABLE: 'PLUGIN_API_UNAVAILABLE',
    PLUGIN_CONNECT_FAILED: 'PLUGIN_CONNECT_FAILED',
    PLUGIN_HOST_INCOMPATIBLE: 'PLUGIN_HOST_INCOMPATIBLE',
    PLUGIN_SDK_NOT_READY: 'PLUGIN_SDK_NOT_READY',
    PLUGIN_STORAGE_DENIED: 'PLUGIN_STORAGE_DENIED'
  };

  function TooldeskPluginError(code, message) {
    this.name = 'TooldeskPluginError';
    this.code = code;
    this.message = message || code;
  }

  TooldeskPluginError.prototype = Object.create(Error.prototype);
  TooldeskPluginError.prototype.constructor = TooldeskPluginError;

  function disablePluginInputAutofill(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return;
    }

    var selector = [
      'textarea',
      'input:not([type])',
      'input[type="email"]',
      'input[type="number"]',
      'input[type="password"]',
      'input[type="search"]',
      'input[type="tel"]',
      'input[type="text"]',
      'input[type="url"]'
    ].join(',');

    root.querySelectorAll(selector).forEach(function (element) {
      if (element.getAttribute('data-tooldesk-autofill-guard') === '1') {
        return;
      }

      element.setAttribute('data-tooldesk-autofill-guard', '1');

      var inputType = String(element.getAttribute('type') || 'text').toLowerCase();
      var autocomplete = inputType === 'password' ? 'new-password' : 'off';
      if (element.tagName === 'TEXTAREA') {
        autocomplete = 'off';
      }

      element.setAttribute('autocomplete', autocomplete);
      element.setAttribute('autocapitalize', 'off');
      element.setAttribute('autocorrect', 'off');
      element.setAttribute('spellcheck', 'false');

      if (!element.getAttribute('name')) {
        var fieldId = element.getAttribute('id');
        if (fieldId) {
          element.setAttribute('name', 'tooldesk-' + fieldId);
        }
      }

      var form = typeof element.closest === 'function' ? element.closest('form') : null;
      if (form && form.getAttribute('data-tooldesk-autofill-guard') !== '1') {
        form.setAttribute('data-tooldesk-autofill-guard', '1');
        form.setAttribute('autocomplete', 'off');
      }
    });
  }

  function installPluginInputAutofillGuard() {
    if (!global.document) {
      return;
    }

    var apply = function () {
      disablePluginInputAutofill(global.document);
    };

    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }

    if (typeof global.MutationObserver === 'function' && global.document.documentElement) {
      new global.MutationObserver(function () {
        apply();
      }).observe(global.document.documentElement, { childList: true, subtree: true });
    }
  }

  installPluginInputAutofillGuard();

  function postToHost(pluginId, payload) {
    window.parent.postMessage(
      Object.assign(
        {
          pluginId: pluginId || undefined,
          source: 'tooldesk-plugin'
        },
        payload
      ),
      '*'
    );
  }

  function resolveInvokeTimeoutMs(args) {
    var requestedTimeoutMs = 0;

    args.forEach(function (arg) {
      if (!arg || typeof arg !== 'object') {
        return;
      }

      var timeoutMs = Number(arg.timeoutMs);
      if (Number.isFinite(timeoutMs) && timeoutMs > requestedTimeoutMs) {
        requestedTimeoutMs = timeoutMs;
      }
    });

    if (requestedTimeoutMs <= 0) {
      return DEFAULT_INVOKE_TIMEOUT_MS;
    }

    return (
      Math.min(Math.floor(requestedTimeoutMs), MAX_CONFIGURED_INVOKE_TIMEOUT_MS) +
      INVOKE_TIMEOUT_GRACE_MS
    );
  }

  function createTooldeskPluginApi(methods, pluginId) {
    var allowedMethods = Array.isArray(methods) ? methods : [];
    var sequence = 0;
    var pending = new Map();
    var eventHandlers = new Map();

    window.addEventListener('message', function (event) {
      var data = event.data || {};

      if (data.source !== 'tooldesk-host') {
        return;
      }

      if (data.type === 'api:event') {
        var handler = eventHandlers.get(data.subscriptionId);

        if (handler) {
          handler(data.payload);
        }

        return;
      }

      if (data.type !== 'api:result') {
        return;
      }

      var task = pending.get(data.requestId);

      if (!task) {
        return;
      }

      pending.delete(data.requestId);

      if (data.ok) {
        task.resolve(data.result);
      } else {
        task.reject(
          new TooldeskPluginError(
            data.code || ERROR_CODES.PLUGIN_API_DENIED,
            data.error || '插件 API 调用失败'
          )
        );
      }
    });

    return Object.fromEntries(
      allowedMethods.map(function (method) {
        return [
          method,
          function () {
            var args = Array.prototype.slice.call(arguments);

            if (method.indexOf('on') === 0 && typeof args[0] === 'function') {
              var requestId = Date.now() + '-' + sequence++;
              var callback = args[0];

              return new Promise(function (resolve, reject) {
                pending.set(requestId, { reject: reject, resolve: resolve });
                postToHost(pluginId, { method: method, requestId: requestId, type: 'api:subscribe' });
              }).then(function (subscriptionId) {
                eventHandlers.set(subscriptionId, callback);

                return function () {
                  eventHandlers.delete(subscriptionId);
                  postToHost(pluginId, { subscriptionId: subscriptionId, type: 'api:unsubscribe' });
                };
              });
            }

            return new Promise(function (resolve, reject) {
              var invokeRequestId = Date.now() + '-' + sequence++;
              var invokeTimeoutMs = resolveInvokeTimeoutMs(args);
              var timeout = setTimeout(function () {
                if (!pending.has(invokeRequestId)) {
                  return;
                }

                pending.delete(invokeRequestId);
                reject(
                  new TooldeskPluginError(
                    ERROR_CODES.PLUGIN_API_UNAVAILABLE,
                    'Plugin API timed out: ' + method
                  )
                );
              }, invokeTimeoutMs);

              pending.set(invokeRequestId, {
                reject: function (error) {
                  clearTimeout(timeout);
                  reject(error);
                },
                resolve: function (value) {
                  clearTimeout(timeout);
                  resolve(value);
                }
              });

              postToHost(pluginId, {
                args: args,
                method: method,
                requestId: invokeRequestId,
                type: 'api:invoke'
              });
            });
          }
        ];
      })
    );
  }

  function bindLaunchContext(handler) {
    if (typeof handler !== 'function') {
      return;
    }

    window.addEventListener('message', function (event) {
      var data = event.data;

      if (data && data.source === 'tooldesk-host' && data.type === 'launch-context') {
        handler(data);
      }
    });
  }

  function requestLaunchContext(pluginId) {
    postToHost(pluginId, { type: 'launch-context:get' });
  }

  function requestHostPermissions(pluginId) {
    return new Promise(function (resolve) {
      var requestId = Date.now() + '-permissions';
      var timeout = setTimeout(function () {
        window.removeEventListener('message', listener);
        resolve([]);
      }, 5000);

      var listener = function (event) {
        var data = event.data || {};

        if (data.source !== 'tooldesk-host' || data.type !== 'permissions:result' || data.requestId !== requestId) {
          return;
        }

        clearTimeout(timeout);
        window.removeEventListener('message', listener);
        resolve(Array.isArray(data.permissions) ? data.permissions : []);
      };

      window.addEventListener('message', listener);
      postToHost(pluginId, { requestId: requestId, type: 'permissions:get' });
    });
  }

  var hostReadyInfo = null;
  var hostReadyWaiters = [];
  var hostReadyRequestedByPluginId = new Set();

  function notifyHostReady(info) {
    hostReadyInfo = info;

    while (hostReadyWaiters.length) {
      var waiter = hostReadyWaiters.shift();

      if (waiter) {
        waiter.resolve(info);
      }
    }
  }

  function waitForHostReady(timeoutMs, pluginId) {
    if (hostReadyInfo) {
      return Promise.resolve(hostReadyInfo);
    }

    return new Promise(function (resolve, reject) {
      var timeout = setTimeout(function () {
        var index = hostReadyWaiters.findIndex(function (item) {
          return item.resolve === resolve;
        });

        if (index >= 0) {
          hostReadyWaiters.splice(index, 1);
        }

        resolve({
          hostApiVersion: HOST_API_VERSION,
          permissions: [],
          sdkVersion: SDK_VERSION
        });
      }, timeoutMs || 5000);

      hostReadyWaiters.push({
        reject: reject,
        resolve: function (info) {
          clearTimeout(timeout);
          resolve(info);
        }
      });

      var pluginKey = String(pluginId || '').trim() || '__default__';

      if (!hostReadyRequestedByPluginId.has(pluginKey)) {
        hostReadyRequestedByPluginId.add(pluginKey);
        postToHost(pluginId, { type: 'host:ready:get' });
      }
    });
  }

  window.addEventListener('message', function (event) {
    var data = event.data || {};

    if (data.source !== 'tooldesk-host' || data.type !== 'host:ready') {
      return;
    }

    notifyHostReady({
      appVersion: data.appVersion,
      hostApiVersion: data.hostApiVersion || HOST_API_VERSION,
      permissions: Array.isArray(data.permissions) ? data.permissions : [],
      pluginId: data.pluginId,
      sdkVersion: data.sdkVersion || SDK_VERSION
    });
  });

  function compareSemver(left, right) {
    var normalize = function (value) {
      return String(value ?? '')
        .trim()
        .replace(/^v/i, '')
        .split('.')
        .map(function (part) {
          return Number.parseInt(part, 10) || 0;
        });
    };

    var leftParts = normalize(left);
    var rightParts = normalize(right);
    var length = Math.max(leftParts.length, rightParts.length);

    for (var index = 0; index < length; index += 1) {
      var diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

      if (diff !== 0) {
        return diff;
      }
    }

    return 0;
  }

  function create(options) {
    var config = options && typeof options === 'object' ? options : {};
    var capabilities = Array.isArray(config.capabilities) ? config.capabilities : [];
    var bridge = null;
    var connected = false;
    var ready = false;
    var connectError = null;
    var hostInfo = null;

    if (typeof config.onLaunchContext === 'function') {
      bindLaunchContext(config.onLaunchContext);
    }

    var pluginId = String(config.id || '').trim();

    function ensureBridge() {
      if (!bridge) {
        bridge = createTooldeskPluginApi(capabilities, pluginId);
      }

      return bridge;
    }

    function invokeApi(method, args) {
      if (!connected) {
        return Promise.reject(
          new TooldeskPluginError(ERROR_CODES.PLUGIN_SDK_NOT_READY, 'Plugin is not connected. Call connect() first.')
        );
      }

      var target = ensureBridge()[method];

      if (typeof target !== 'function') {
        return Promise.reject(
          new TooldeskPluginError(ERROR_CODES.PLUGIN_API_UNAVAILABLE, 'Plugin API unavailable: ' + method)
        );
      }

      return target.apply(null, args);
    }

    var api = new Proxy(
      {},
      {
        get: function (_target, prop) {
          if (prop === 'then') {
            return undefined;
          }

          var method = String(prop);

          return function () {
            var args = Array.prototype.slice.call(arguments);
            return invokeApi(method, args);
          };
        }
      }
    );

    function getHostInfo() {
      if (hostInfo) {
        return Promise.resolve(hostInfo);
      }

      return waitForHostReady(undefined, pluginId).then(function (info) {
        return requestHostPermissions(pluginId).then(function (permissions) {
          hostInfo = {
            appVersion: info.appVersion,
            hostApiVersion: info.hostApiVersion || HOST_API_VERSION,
            permissions: permissions,
            sdkVersion: info.sdkVersion || SDK_VERSION
          };

          return hostInfo;
        });
      });
    }

    function connect() {
      if (connected) {
        return Promise.resolve({ error: connectError, hostInfo: hostInfo, ready: ready });
      }

      connected = true;
      ensureBridge();

      return waitForHostReady(undefined, pluginId)
        .then(function (info) {
          hostInfo = {
            appVersion: info.appVersion,
            hostApiVersion: info.hostApiVersion || HOST_API_VERSION,
            permissions: info.permissions || [],
            sdkVersion: info.sdkVersion || SDK_VERSION
          };

          if (config.minHostVersion && info.appVersion && compareSemver(info.appVersion, config.minHostVersion) < 0) {
            throw new TooldeskPluginError(
              ERROR_CODES.PLUGIN_HOST_INCOMPATIBLE,
              'Host version ' + info.appVersion + ' is below required ' + config.minHostVersion
            );
          }

          return requestHostPermissions(pluginId).then(function (permissions) {
            hostInfo.permissions = permissions;
            ready = true;

            if (typeof config.onReady === 'function') {
              config.onReady(hostInfo);
            }

            requestLaunchContext(pluginId);
            return { error: null, hostInfo: hostInfo, ready: true };
          });
        })
        .catch(function (error) {
          connectError = error instanceof TooldeskPluginError ? error : new TooldeskPluginError(ERROR_CODES.PLUGIN_CONNECT_FAILED, error && error.message ? error.message : 'Plugin connect failed');

          if (typeof config.onError === 'function') {
            config.onError(connectError);
          }

          ready = false;
          return { error: connectError, hostInfo: hostInfo, ready: false };
        });
    }

    return {
      api: api,
      connect: connect,
      getHostInfo: getHostInfo,
      id: String(config.id || '').trim()
    };
  }

  global.TooldeskPlugin = {
    ERROR_CODES: ERROR_CODES,
    HOST_API_VERSION: HOST_API_VERSION,
    SDK_VERSION: SDK_VERSION,
    TooldeskPluginError: TooldeskPluginError,
    create: create
  };
})(window);
